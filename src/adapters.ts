import { BigNumber, BigNumberish, BytesLike, ethers } from 'ethers';
import { IERC20MetadataFactory, IL1BridgeFactory, IL2BridgeFactory, IZkSyncFactory, CronosTestnetFactory} from '../typechain';
import { Provider } from './provider';
import { Address, BalancesMap, BlockTag, Eip712Meta, PriorityOpResponse, TransactionResponse } from './types';
import {
    BOOTLOADER_FORMAL_ADDRESS,
    DEFAULT_GAS_PER_PUBDATA_LIMIT,
    REQUIRED_L1_TO_L2_GAS_PER_PUBDATA_LIMIT,
    ETH_ADDRESS,
    isETH,
    L1_MESSENGER_ADDRESS,
    layer1TxDefaults,
    undoL1ToL2Alias,
    estimateDefaultBridgeDepositL2Gas,
    L2_ETH_TOKEN_ADDRESS
} from './utils';

import { CronosTestnet } from "../typechain/CronosTestnet";

type Constructor<T = {}> = new (...args: any[]) => T;

interface TxSender {
    sendTransaction(tx: ethers.providers.TransactionRequest): Promise<ethers.providers.TransactionResponse>;
    getAddress(): Promise<Address>;
}

export function AdapterL1<TBase extends Constructor<TxSender>>(Base: TBase) {
    return class Adapter extends Base {
        _providerL2(): Provider {
            throw new Error('Must be implemented by the derived class!');
        }
        _providerL1(): ethers.providers.Provider {
            throw new Error('Must be implemented by the derived class!');
        }
        _signerL1(): ethers.Signer {
            throw new Error('Must be implemented by the derived class!');
        }

        _baseTokenAddress?: string;

        async getMainContract() {
            const address = await this._providerL2().getMainContractAddress();
            return IZkSyncFactory.connect(address, this._signerL1());
        }

        async getBaseTokenContract(): Promise<CronosTestnet> {
            return CronosTestnetFactory.connect(await this.baseTokenAddress(), this._signerL1());
        }

        async baseTokenAddress(): Promise<string> {
            if (this._baseTokenAddress == undefined) {
                const zkSyncContract = await this.getMainContract();
                this._baseTokenAddress = (await zkSyncContract.baseTokenAddress()).toLowerCase();
            }

            return this._baseTokenAddress;
        }

        async getL1BridgeContracts() {
            const addresses = await this._providerL2().getDefaultBridgeAddresses();
            return {
                erc20: IL1BridgeFactory.connect(addresses.erc20L1, this._signerL1())
            };
        }

        async getBalanceL1(token?: Address, blockTag?: ethers.providers.BlockTag): Promise<BigNumber> {
            token ??= ETH_ADDRESS;
            if (isETH(token)) {
                return await this._providerL1().getBalance(await this.getAddress(), blockTag);
            } else {
                const erc20contract = IERC20MetadataFactory.connect(token, this._providerL1());
                return await erc20contract.balanceOf(await this.getAddress());
            }
        }

        async l2TokenAddress(token: Address) {
            if (token == ETH_ADDRESS) {
                return ETH_ADDRESS;
            }  else if (token.toLowerCase() == (await this.baseTokenAddress())) {
                return ETH_ADDRESS;
            } else {
                const erc20Bridge = (await this.getL1BridgeContracts()).erc20;
                return await erc20Bridge.l2TokenAddress(token);
            }
        }

        async approveERC20(
            token: Address,
            amount: BigNumberish,
            overrides?: ethers.Overrides & { bridgeAddress?: Address }
        ): Promise<ethers.providers.TransactionResponse> {
            if (isETH(token)) {
                throw new Error("ETH token can't be approved. The address of the token does not exist on L1.");
            }

            let bridgeAddress = overrides?.bridgeAddress;
            const erc20contract = IERC20MetadataFactory.connect(token, this._signerL1());

            if (bridgeAddress == null) {
                bridgeAddress = (await this._providerL2().getDefaultBridgeAddresses()).erc20L1;
            } else {
                delete overrides.bridgeAddress;
            }

            return await erc20contract.approve(bridgeAddress, amount, overrides);
        }

        async approveBaseToken(amount: BigNumberish): Promise<ethers.ContractReceipt> {
            const CRO = CronosTestnetFactory.connect(await this.baseTokenAddress(), this._signerL1());
            const contractAddress = await this._providerL2().getMainContractAddress();

            console.info("Sending CRO approve tx");
            const approveTx = await CRO.approve(contractAddress, amount);
            const receipt = await approveTx.wait();
            return receipt;
        }

        async getBaseCost(params: {
            gasLimit: BigNumberish;
            gasPerPubdataByte?: BigNumberish;
            gasPrice?: BigNumberish;
        }): Promise<BigNumber> {
            const zksyncContract = await this.getMainContract();
            const parameters = { ...layer1TxDefaults(), ...params };
            parameters.gasPrice ??= await this._providerL1().getGasPrice();
            parameters.gasPerPubdataByte ??= REQUIRED_L1_TO_L2_GAS_PER_PUBDATA_LIMIT;

            return BigNumber.from(
                await zksyncContract.l2TransactionBaseCost(
                    parameters.gasPrice,
                    parameters.gasLimit,
                    parameters.gasPerPubdataByte
                )
            );
        }

        async deposit(transaction: {
            token: Address;
            amount: BigNumberish;
            to?: Address;
            operatorTip?: BigNumberish;
            bridgeAddress?: Address;
            approveERC20?: boolean;
            l2GasLimit?: BigNumberish;
            gasPerPubdataByte?: BigNumberish;
            refundRecipient?: Address;
            overrides?: ethers.PayableOverrides;
            approveOverrides?: ethers.Overrides;
        }): Promise<PriorityOpResponse> {
            const depositTx = await this.getDepositTx(transaction);
            if (transaction.token == ETH_ADDRESS) {
                return this.requestExecute(depositTx);
            } else if (transaction.token == (await this.baseTokenAddress())) {
                const CRO = CronosTestnetFactory.connect(transaction.token, this._signerL1());
                const contractAddress = await this._providerL2().getMainContractAddress();

                let allowance = await CRO.allowance(await this.getAddress(), contractAddress);

                if (allowance < BigNumber.from(depositTx.amount)) {
                    console.info(
                        "CRO allowance amount is low:",
                        "allowance:",
                        ethers.utils.formatEther(allowance),
                        "tx-amount:",
                        ethers.utils.formatEther(transaction.amount),
                        "total cost:",
                        ethers.utils.formatEther(depositTx.overrides.value),
                    );
                    console.info("Sending CRO approve tx");
                    const approveTx = await CRO.approve(contractAddress, transaction.amount);
                    await approveTx.wait();
                }

                return await this.requestExecute(depositTx);
            } else {
                const bridgeContracts = await this.getL1BridgeContracts();
                if (transaction.approveERC20) {
                    const approveTx = await this.approveERC20(transaction.token, transaction.amount, {
                        bridgeAddress: transaction.bridgeAddress ?? bridgeContracts.erc20.address,
                        ...transaction.approveOverrides
                    });
                    await approveTx.wait();
                }

                // the sender requires to approve base token to be able to proceed estimateGas
                const CRO = CronosTestnetFactory.connect(
                    await this.baseTokenAddress(),
                    this._signerL1(),
                );
                const contractAddress = await this._providerL2().getMainContractAddress();
                let allowance_CRO = await CRO.allowance(await this.getAddress(), contractAddress);
                if (allowance_CRO < BigNumber.from(depositTx.value)) {
                    const approveTx = await CRO.approve(contractAddress, depositTx.value);
                    await approveTx.wait();
                } 

                return await this._providerL2().getPriorityOpResponse(
                    await this._signerL1().sendTransaction(depositTx)
                );
            }
        }

        async estimateGasDeposit(transaction: {
            token: Address;
            amount: BigNumberish;
            to?: Address;
            operatorTip?: BigNumberish;
            bridgeAddress?: Address;
            l2GasLimit?: BigNumberish;
            gasPerPubdataByte?: BigNumberish;
            overrides?: ethers.PayableOverrides;
        }): Promise<ethers.BigNumber> {
            const depositTx = await this.getDepositTx(transaction);
            if (transaction.token == ETH_ADDRESS) {
                return await this.estimateGasRequestExecute(depositTx);
            } else {
                return await this._providerL1().estimateGas(depositTx);
            }
        }

        async getDepositTx(transaction: {
            token: Address;
            amount: BigNumberish;
            to?: Address;
            operatorTip?: BigNumberish;
            bridgeAddress?: Address;
            l2GasLimit?: BigNumberish;
            gasPerPubdataByte?: BigNumberish;
            refundRecipient?: Address;
            overrides?: ethers.PayableOverrides;
        }): Promise<any> {
            const bridgeContracts = await this.getL1BridgeContracts();
            if (transaction.bridgeAddress) {
                bridgeContracts.erc20.attach(transaction.bridgeAddress);
            }

            const { ...tx } = transaction;
            tx.to ??= await this.getAddress();
            tx.operatorTip ??= BigNumber.from(0);
            tx.overrides ??= {};
            tx.gasPerPubdataByte ??= REQUIRED_L1_TO_L2_GAS_PER_PUBDATA_LIMIT;
            tx.l2GasLimit ??= await estimateDefaultBridgeDepositL2Gas(
                this._providerL1(),
                this._providerL2(),
                tx.token,
                tx.amount,
                tx.to,
                await this.getAddress(),
                tx.gasPerPubdataByte
            );

            const { to, token, amount, operatorTip, refundRecipient, overrides } = tx;

            await insertGasPrice(this._providerL1(), overrides);
            const gasPriceForEstimation = overrides.maxFeePerGas || overrides.gasPrice;

            const zksyncContract = await this.getMainContract();

            const baseCost = await zksyncContract.l2TransactionBaseCost(
                await gasPriceForEstimation,
                tx.l2GasLimit,
                tx.gasPerPubdataByte
            );

            if (token == ETH_ADDRESS) {
                overrides.value ??= baseCost.add(operatorTip).add(amount);

                return {
                    contractAddress: to,
                    calldata: '0x',
                    l2Value: amount,
                    // For some reason typescript can not deduce that we've already set the
                    // tx.l2GasLimit
                    l2GasLimit: tx.l2GasLimit!,
                    ...tx
                };
            } else if (token.toLowerCase() == (await this.baseTokenAddress())) {
                overrides.value ??= baseCost.add(BigNumber.from(operatorTip));
                return {
                    contractAddress: to,
                    calldata: "0x",
                    l2Value: 0,
                    ...tx,
                };                
            } else {
                const l1Amount = baseCost.add(BigNumber.from(operatorTip));
                const args: [Address, Address, BigNumberish, BigNumberish, BigNumberish, Address,
                    BigNumberish] = [
                    to,
                    token,
                    amount,
                    tx.l2GasLimit,
                    tx.gasPerPubdataByte,
                    refundRecipient, l1Amount,
                ];

                overrides.value ??= l1Amount;

                // TODO: compatibility layer: using the old API which uses msg.sender as the
                // refund recipient, to make the SDK compatible with the old contracts.
                // const contract = bridgeContracts.erc20 as ethers.Contract;
                return await bridgeContracts.erc20.populateTransaction.deposit(...args, overrides);
            }
        }

        async _getWithdrawalLog(withdrawalHash: BytesLike, index: number = 0) {
            const hash = ethers.utils.hexlify(withdrawalHash);
            const receipt = await this._providerL2().getTransactionReceipt(hash);
            const log = receipt.logs.filter(
                (log) =>
                    log.address == L1_MESSENGER_ADDRESS &&
                    log.topics[0] == ethers.utils.id('L1MessageSent(address,bytes32,bytes)')
            )[index];

            return {
                log,
                l1BatchTxId: receipt.l1BatchTxIndex
            };
        }

        async _getWithdrawalL2ToL1Log(withdrawalHash: BytesLike, index: number = 0) {
            const hash = ethers.utils.hexlify(withdrawalHash);
            const receipt = await this._providerL2().getTransactionReceipt(hash);
            const messages = Array.from(receipt.l2ToL1Logs.entries()).filter(
                ([_, log]) => log.sender == L1_MESSENGER_ADDRESS
            );
            const [l2ToL1LogIndex, l2ToL1Log] = messages[index];

            return {
                l2ToL1LogIndex,
                l2ToL1Log
            };
        }

        async finalizeWithdrawalParams(withdrawalHash: BytesLike, index: number = 0) {
            const { log, l1BatchTxId } = await this._getWithdrawalLog(withdrawalHash, index);
            const { l2ToL1LogIndex } = await this._getWithdrawalL2ToL1Log(withdrawalHash, index);
            const sender = ethers.utils.hexDataSlice(log.topics[1], 12);
            const proof = await this._providerL2().getLogProof(withdrawalHash, l2ToL1LogIndex);
            const message = ethers.utils.defaultAbiCoder.decode(['bytes'], log.data)[0];
            return {
                l1BatchNumber: log.l1BatchNumber,
                l2MessageIndex: proof.id,
                l2TxNumberInBlock: l1BatchTxId,
                message,
                sender,
                proof: proof.proof
            };
        }

        async finalizeWithdrawal(withdrawalHash: BytesLike, index: number = 0, overrides?: ethers.Overrides) {
            const { l1BatchNumber, l2MessageIndex, l2TxNumberInBlock, message, sender, proof } =
                await this.finalizeWithdrawalParams(withdrawalHash, index);

            if (isETH(sender)) {
                const contractAddress = await this._providerL2().getMainContractAddress();
                const zksync = IZkSyncFactory.connect(contractAddress, this._signerL1());

                return await zksync.finalizeEthWithdrawal(
                    l1BatchNumber,
                    l2MessageIndex,
                    l2TxNumberInBlock,
                    message,
                    proof,
                    overrides ?? {}
                );
            } else if (L2_ETH_TOKEN_ADDRESS == sender.toLowerCase()) {
                const contractAddress = await this._providerL2().getMainContractAddress();
                const zksync = IZkSyncFactory.connect(contractAddress, this._signerL1());
                return await zksync.finalizeEthWithdrawal(
                    l1BatchNumber as BigNumberish,
                    l2MessageIndex as BigNumberish,
                    l2TxNumberInBlock as BigNumberish,
                    message,
                    proof,
                    overrides ?? {},
                );
            }

            const l2Bridge = IL2BridgeFactory.connect(sender, this._providerL2());
            const l1Bridge = IL1BridgeFactory.connect(await l2Bridge.l1Bridge(), this._signerL1());
            return await l1Bridge.finalizeWithdrawal(
                l1BatchNumber,
                l2MessageIndex,
                l2TxNumberInBlock,
                message,
                proof,
                overrides ?? {}
            );
        }

        async isWithdrawalFinalized(withdrawalHash: BytesLike, index: number = 0) {
            const { log } = await this._getWithdrawalLog(withdrawalHash, index);
            const { l2ToL1LogIndex } = await this._getWithdrawalL2ToL1Log(withdrawalHash, index);
            const sender = ethers.utils.hexDataSlice(log.topics[1], 12);
            // `getLogProof` is called not to get proof but
            // to get the index of the corresponding L2->L1 log,
            // which is returned as `proof.id`.
            const proof = await this._providerL2().getLogProof(withdrawalHash, l2ToL1LogIndex);

            if (isETH(sender)) {
                const contractAddress = await this._providerL2().getMainContractAddress();
                const zksync = IZkSyncFactory.connect(contractAddress, this._signerL1());

                return await zksync.isEthWithdrawalFinalized(log.l1BatchNumber, proof.id);
            }

            const l2Bridge = IL2BridgeFactory.connect(sender, this._providerL2());
            const l1Bridge = IL1BridgeFactory.connect(await l2Bridge.l1Bridge(), this._providerL1());

            return await l1Bridge.isWithdrawalFinalized(log.l1BatchNumber, proof.id);
        }

        async claimFailedDeposit(depositHash: BytesLike, overrides?: ethers.Overrides) {
            const receipt = await this._providerL2().getTransactionReceipt(ethers.utils.hexlify(depositHash));
            const successL2ToL1LogIndex = receipt.l2ToL1Logs.findIndex(
                (l2ToL1log) => l2ToL1log.sender == BOOTLOADER_FORMAL_ADDRESS && l2ToL1log.key == depositHash
            );
            const successL2ToL1Log = receipt.l2ToL1Logs[successL2ToL1LogIndex];
            if (successL2ToL1Log.value != ethers.constants.HashZero) {
                throw new Error('Cannot claim successful deposit');
            }

            const tx = await this._providerL2().getTransaction(ethers.utils.hexlify(depositHash));

            // Undo the aliasing, since the Mailbox contract set it as for contract address.
            const l1BridgeAddress = undoL1ToL2Alias(receipt.from);
            const l2BridgeAddress = receipt.to;

            const l1Bridge = IL1BridgeFactory.connect(l1BridgeAddress, this._signerL1());
            const l2Bridge = IL2BridgeFactory.connect(l2BridgeAddress, this._providerL2());

            const calldata = l2Bridge.interface.decodeFunctionData('finalizeDeposit', tx.data);

            const proof = await this._providerL2().getLogProof(depositHash, successL2ToL1LogIndex);
            return await l1Bridge.claimFailedDeposit(
                calldata['_l1Sender'],
                calldata['_l1Token'],
                depositHash,
                receipt.l1BatchNumber,
                proof.id,
                receipt.l1BatchTxIndex,
                proof.proof,
                overrides ?? {}
            );
        }

        async requestExecute(transaction: {
            contractAddress: Address;
            calldata: BytesLike;
            amount: BigNumberish;
            l2GasLimit?: BigNumberish;
            l2Value?: BigNumberish;
            factoryDeps?: ethers.BytesLike[];
            operatorTip?: BigNumberish;
            gasPerPubdataByte?: BigNumberish;
            refundRecipient?: Address;
            overrides?: ethers.PayableOverrides;
        }): Promise<PriorityOpResponse> {
            const requestExecuteTx = await this.getRequestExecuteTx(transaction);
            return this._providerL2().getPriorityOpResponse(await this._signerL1().sendTransaction(requestExecuteTx));
        }

        async estimateGasRequestExecute(transaction: {
            contractAddress: Address;
            calldata: BytesLike;
            amount: BigNumberish;
            l2GasLimit?: BigNumberish;
            l2Value?: BigNumberish;
            factoryDeps?: ethers.BytesLike[];
            operatorTip?: BigNumberish;
            gasPerPubdataByte?: BigNumberish;
            refundRecipient?: Address;
            overrides?: ethers.PayableOverrides;
        }): Promise<ethers.BigNumber> {
            const requestExecuteTx = await this.getRequestExecuteTx(transaction);
            return this._providerL1().estimateGas(requestExecuteTx);
        }

        async getRequestExecuteTx(transaction: {
            contractAddress: Address;
            calldata: BytesLike;
            amount: BigNumberish;
            l2GasLimit?: BigNumberish;
            l2Value?: BigNumberish;
            factoryDeps?: ethers.BytesLike[];
            operatorTip?: BigNumberish;
            gasPerPubdataByte?: BigNumberish;
            refundRecipient?: Address;
            overrides?: ethers.PayableOverrides;
        }): Promise<ethers.PopulatedTransaction> {
            const zksyncContract = await this.getMainContract();

            const { ...tx } = transaction;
            tx.l2Value ??= BigNumber.from(0);
            tx.operatorTip ??= BigNumber.from(0);
            tx.factoryDeps ??= [];
            tx.overrides ??= {};
            tx.gasPerPubdataByte ??= REQUIRED_L1_TO_L2_GAS_PER_PUBDATA_LIMIT;
            tx.refundRecipient ??= await this.getAddress();
            tx.l2GasLimit ??= await this._providerL2().estimateL1ToL2Execute(transaction);

            const {
                contractAddress,
                l2Value,
                calldata,
                l2GasLimit,
                factoryDeps,
                operatorTip,
                overrides,
                gasPerPubdataByte,
                refundRecipient,
                amount
            } = tx;

            await insertGasPrice(this._providerL1(), overrides);
            const gasPriceForEstimation = overrides.maxFeePerGas || overrides.gasPrice;

            const baseCost = await this.getBaseCost({
                gasPrice: await gasPriceForEstimation,
                gasPerPubdataByte,
                gasLimit: l2GasLimit
            });

            // fee on L2 is subsctracted from the amount
            // overrides.value ??= baseCost + BigInt(operatorTip) + BigInt(l2Value);
            // await checkBaseCost(baseCost, overrides.value);

            let l2tx: {
                l2Contract: string;
                l2Value: BigNumberish;
                l2GasLimit: BigNumberish;
                l2GasPerPubdataByteLimit: BigNumberish;
            } 
            
            l2tx.l2Contract = contractAddress
            l2tx.l2Value = l2Value;
            l2tx.l2GasLimit = l2GasLimit;
            l2tx.l2GasPerPubdataByteLimit = REQUIRED_L1_TO_L2_GAS_PER_PUBDATA_LIMIT;

            return await zksyncContract.populateTransaction.requestL2Transaction(
                l2tx,
                calldata,                
                factoryDeps,
                refundRecipient,
                amount,
                overrides
            );
        }
    };
}

export function AdapterL2<TBase extends Constructor<TxSender>>(Base: TBase) {
    return class Adapter extends Base {
        _providerL2(): Provider {
            throw new Error('Must be implemented by the derived class!');
        }
        _signerL2(): ethers.Signer {
            throw new Error('Must be implemented by the derived class!');
        }

        async getBalance(token?: Address, blockTag: BlockTag = 'committed') {
            return await this._providerL2().getBalance(await this.getAddress(), blockTag, token);
        }

        async getAllBalances(): Promise<BalancesMap> {
            return await this._providerL2().getAllAccountBalances(await this.getAddress());
        }

        async getL2BridgeContracts() {
            const addresses = await this._providerL2().getDefaultBridgeAddresses();
            return {
                erc20: IL2BridgeFactory.connect(addresses.erc20L2, this._signerL2())
            };
        }

        _fillCustomData(data: Eip712Meta): Eip712Meta {
            const customData = { ...data };
            customData.gasPerPubdata ??= DEFAULT_GAS_PER_PUBDATA_LIMIT;
            customData.factoryDeps ??= [];
            return customData;
        }

        async withdraw(transaction: {
            token: Address;
            amount: BigNumberish;
            to?: Address;
            bridgeAddress?: Address;
            overrides?: ethers.Overrides;
        }): Promise<TransactionResponse> {
            const withdrawTx = await this._providerL2().getWithdrawTx({
                from: await this.getAddress(),
                ...transaction
            });
            const txResponse = await this.sendTransaction(withdrawTx);
            return this._providerL2()._wrapTransaction(txResponse);
        }

        async transfer(transaction: {
            to: Address;
            amount: BigNumberish;
            token?: Address;
            overrides?: ethers.Overrides;
        }): Promise<TransactionResponse> {
            const transferTx = await this._providerL2().getTransferTx({
                from: await this.getAddress(),
                ...transaction
            });
            const txResponse = await this.sendTransaction(transferTx);
            return this._providerL2()._wrapTransaction(txResponse);
        }
    };
}

/// @dev This method checks if the overrides contain a gasPrice (or maxFeePerGas), if not it will insert
/// the maxFeePerGas
async function insertGasPrice(l1Provider: ethers.providers.Provider, overrides: ethers.PayableOverrides) {
    if (!overrides.gasPrice && !overrides.maxFeePerGas) {
        const l1FeeData = await l1Provider.getFeeData();

        // Sometimes baseFeePerGas is not available, so we use gasPrice instead.
        const baseFee = l1FeeData.lastBaseFeePerGas || l1FeeData.gasPrice;

        // ethers.js by default uses multiplcation by 2, but since the price for the L2 part
        // will depend on the L1 part, doubling base fee is typically too much.
        const maxFeePerGas = baseFee.mul(3).div(2).add(l1FeeData.maxPriorityFeePerGas);

        overrides.maxFeePerGas = maxFeePerGas;
        overrides.maxPriorityFeePerGas = l1FeeData.maxPriorityFeePerGas;
    }
}
