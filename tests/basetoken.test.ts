import { expect } from "chai";
import { Provider, types, Wallet } from "../src";
import { BigNumber, ethers } from "ethers";
import { sleep } from "../src/utils";
import { Address } from "../src/types";

const mnemonic = "stuff slice staff easily soup parent arm payment cotton trade scatter struggle";
const mnemonic2 = "test test test test test test test test test test test junk";
const testTimeout = 30_000;
const provider = Provider.getDefaultProvider() as Provider;
const ethProvider = ethers.getDefaultProvider("http://127.0.0.1:8545");

describe("BaseToken", () => {
    let mnemonicWallet = ethers.Wallet.fromMnemonic(mnemonic);
    let mnemonicWallet2 = ethers.Wallet.fromMnemonic(mnemonic2);

    const wallet = new Wallet(mnemonicWallet.privateKey, provider, ethProvider);
    const wallet2 = new Wallet(mnemonicWallet2.privateKey, provider, ethProvider);
    let BASE_TOKEN_ADDR: Address;

    before("setup", async function () {
        BASE_TOKEN_ADDR = await wallet.baseTokenAddress();
    });

    // describe("#depositFee()", async () => {
    //     it("should estimates the base token deposit fee", async () => {
    //         const deposit_amount = ethers.utils.parseEther("1");
    //         const tx = {
    //             token: BASE_TOKEN_ADDR,
    //             amount: deposit_amount,
    //         };

    //         const depositTx = await wallet.getDepositTx(tx);
    //         const fee = await wallet.getFullRequiredDepositFee(depositTx);
    //         expect(fee).not.to.be.null;
    //     }).timeout(testTimeout);
    // });

    describe("#deposit()", async () => {
        it("should deposit L1 balance to L2", async () => {
            console.log("wallet address", await wallet.getAddress());
            const l1_balance = await wallet.getBalanceL1(BASE_TOKEN_ADDR);
            console.log("w1_l1_balance: ", ethers.utils.formatEther(l1_balance));
            console.log("w1_l2_balance: ", ethers.utils.formatEther(await wallet.getBalance(BASE_TOKEN_ADDR)));
            console.log("w1_l1_ETH_balance: ", ethers.utils.formatEther(await wallet.getBalanceL1()));
            const deposit_amount = ethers.utils.parseEther("1.0");
            const deposit = await wallet.deposit({
                token: BASE_TOKEN_ADDR,
                amount: deposit_amount,
            });
            expect(deposit).not.to.be.null;

            const receipt = await deposit.waitFinalize();
            expect(receipt).not.to.be.null;

            const l1_balance_new = await wallet.getBalanceL1(BASE_TOKEN_ADDR);
            console.log("w1_l1_balance after deposit: ", ethers.utils.formatEther(l1_balance_new));
            console.log(
                "w1_l1_ETH_balance after deposit: ",
                ethers.utils.formatEther(await wallet.getBalanceL1()),
            );
            expect(l1_balance.sub(l1_balance_new)).to.be.equal(deposit_amount);
            console.log(
                "w1_l2_balance after deposit: ",
                ethers.utils.formatEther(await wallet.getBalance(BASE_TOKEN_ADDR)),
            );
        }).timeout(testTimeout);
    });

    describe("#transfer()", () => {
        it("should transfer L2 balance", async () => {
            console.log("w1_l2_balance: ", ethers.utils.formatEther(await wallet.getBalance(BASE_TOKEN_ADDR)));

            const l2_balance = await wallet2.getBalance(BASE_TOKEN_ADDR);
            console.log("w2_l2_balance: ", ethers.utils.formatEther(l2_balance));

            const transfer_amount = ethers.utils.parseEther("0.1");
            const transfer = await wallet.transfer({
                to: await wallet2.getAddress(),
                token: BASE_TOKEN_ADDR,
                amount: transfer_amount,
            });
            expect(transfer).not.to.be.null;

            await transfer.waitFinalize();

            console.log(
                "w1_l2_balance after transfer: ",
                ethers.utils.formatEther(await wallet.getBalance(BASE_TOKEN_ADDR)),
            );

            const l2_balance_new = await wallet2.getBalance(BASE_TOKEN_ADDR);
            console.log("w2_l2_balance after transfer: ", ethers.utils.formatEther(l2_balance_new));
            expect(l2_balance_new.sub(l2_balance)).to.be.equal(transfer_amount);
        });
    });

    describe("#withdraw()", () => {
        it("should withdraw L2 balance to L1", async () => {
            const l1_balance = await wallet.getBalanceL1(BASE_TOKEN_ADDR);
            console.log("w2_l1_balance: ", ethers.utils.formatEther(l1_balance));

            const l2_balance = await wallet.getBalance(BASE_TOKEN_ADDR);
            console.log("w2_l2_balance: ", ethers.utils.formatEther(l2_balance));

            const withdraw_amount = ethers.utils.parseEther("0.1");
            expect(l2_balance > withdraw_amount).to.be.true;
            const withdrawTx = await wallet.withdraw({
                token: BASE_TOKEN_ADDR,
                amount: withdraw_amount,
            });
            expect(withdrawTx).not.to.be.null;

            await withdrawTx.waitFinalize();
            const finalizeWithdrawTx = await wallet.finalizeWithdrawal(withdrawTx.hash);
            const result = await finalizeWithdrawTx.wait();
            expect(result).not.to.be.null;

            const l1_balance_new = await wallet.getBalanceL1(BASE_TOKEN_ADDR);
            console.log("w2_l1_balance after withdraw: ", ethers.utils.formatEther(l1_balance_new));

            const l2_balance_new = await wallet.getBalance(BASE_TOKEN_ADDR);
            console.log("w2_l2_balance after withdraw: ", ethers.utils.formatEther(l2_balance_new));

            expect(l1_balance_new.sub(l1_balance)).to.be.equal(withdraw_amount);
        }).timeout(testTimeout);
    });
});

describe("ERC20", () => {
    const DAI_ADDRESS = "0x17787f7A5b80512CfE552882B7a55B868a185995"; // the address be defined in the deployed test token list

    let mnemonicWallet = ethers.Wallet.fromMnemonic(mnemonic);    
    let mnemonicWallet2 = ethers.Wallet.fromMnemonic(mnemonic2);

    const wallet = new Wallet(mnemonicWallet.privateKey, provider, ethProvider);
    const wallet2 = new Wallet(mnemonicWallet2.privateKey, provider, ethProvider);
    let BASE_TOKEN_ADDR: Address;
    let L2_ERC20_ADDR: Address;

    before("setup", async function () {
        BASE_TOKEN_ADDR = await wallet.baseTokenAddress();
        L2_ERC20_ADDR = await provider.l2TokenAddress(DAI_ADDRESS);
    });

    describe("#deposit()", async () => {
        it("deposit DAI token on L2", async () => {
            const l1_DAI_balance = await wallet.getBalanceL1(DAI_ADDRESS);
            console.log("w1_l1_DAI_balance: ", ethers.utils.formatEther(l1_DAI_balance));
            const l2_DAI_balance = await wallet.getBalance(L2_ERC20_ADDR);
            console.log("w1_l2_DAI_balance: ", ethers.utils.formatEther(l2_DAI_balance));

            const deposit_amount = ethers.utils.parseEther("2");

            const priorityOpResponse = await wallet.deposit({
                token: DAI_ADDRESS,
                to: await wallet.getAddress(),
                amount: deposit_amount,
                approveERC20: true,
                refundRecipient: await wallet.getAddress(),
            });
            const receipt = await priorityOpResponse.waitFinalize();
            expect(receipt).not.to.be.null;

            const l1_DAI_balance_new = await wallet.getBalanceL1(DAI_ADDRESS);
            console.log("w1_l1_DAI_balance after deposit: ", ethers.utils.formatEther(l1_DAI_balance_new));
            const l2_DAI_balance_new = await wallet.getBalance(L2_ERC20_ADDR);
            console.log("w1_l2_DAI_balance after deposit: ", ethers.utils.formatEther(l2_DAI_balance_new));

            expect(l1_DAI_balance.sub(l1_DAI_balance_new)).to.be.equal(deposit_amount);
            expect(l2_DAI_balance_new.sub(l2_DAI_balance)).to.be.equal(deposit_amount);
        }).timeout(testTimeout * 2);
    });

    describe("#transfer()", async () => {
        it("should transfer L2 ERC20 balance", async () => {
            const w1_l2_DAI_balance = await wallet.getBalance(L2_ERC20_ADDR);
            console.log("w1_l2_DAI_balance: ", ethers.utils.formatEther(w1_l2_DAI_balance));
            const w2_l2_DAI_balance = await wallet2.getBalance(L2_ERC20_ADDR);
            console.log("w2_l2_DAI_balance: ", ethers.utils.formatEther(w2_l2_DAI_balance));
            const w1_l2_base_token_balance = await wallet.getBalance(BASE_TOKEN_ADDR);
            console.log("w2_l2_BASE_TOKEN_balance: ", ethers.utils.formatEther(w1_l2_base_token_balance));

            const transfer_amount = ethers.utils.parseEther("1");

            const transfer = await wallet.transfer({
                token: L2_ERC20_ADDR,
                to: await wallet2.getAddress(),
                amount: transfer_amount,
            });
            expect(transfer).not.to.be.null;

            await transfer.waitFinalize();

            const w1_l2_DAI_balance_new = await wallet.getBalance(L2_ERC20_ADDR);
            console.log("w1_l2_DAI_balance after deposit: ", ethers.utils.formatEther(w1_l2_DAI_balance_new));
            const w2_l2_DAI_balance_new = await wallet2.getBalance(L2_ERC20_ADDR);
            console.log("w2_l2_DAI_balance after deposit:", ethers.utils.formatEther(w2_l2_DAI_balance_new));
            const w1_l2_base_token_balance_new = await wallet.getBalance(BASE_TOKEN_ADDR);
            console.log(
                "w2_l2_BASE_TOKEN_balance: after deposit",
                ethers.utils.formatEther(w1_l2_base_token_balance_new),
            );

            expect(w1_l2_DAI_balance.sub(w1_l2_DAI_balance_new)).to.be.equal(transfer_amount);
            expect(w2_l2_DAI_balance_new.sub(w2_l2_DAI_balance)).to.be.equal(transfer_amount);
            expect(w1_l2_base_token_balance.sub(w1_l2_base_token_balance_new) > BigNumber.from(0)).to.be.true;
        }).timeout(testTimeout);
    });

    describe("#withdraw()", async () => {
        it("should withdraw L2 ERC20 balance", async () => {
            const w1_l2_DAI_balance = await wallet.getBalance(L2_ERC20_ADDR);
            console.log("w1_l2_DAI_balance: ", ethers.utils.formatEther(w1_l2_DAI_balance));
            const w1_l1_DAI_balance = await wallet.getBalanceL1(DAI_ADDRESS);
            console.log("w1_l1_DAI_balance: ", ethers.utils.formatEther(w1_l1_DAI_balance));
            const w1_l2_base_token_balance = await wallet.getBalance(BASE_TOKEN_ADDR);
            console.log("w2_l2_BASE_TOKEN_balance: ", ethers.utils.formatEther(w1_l2_base_token_balance));

            const withdraw_amount = ethers.utils.parseEther("1");
            expect(w1_l2_DAI_balance > withdraw_amount).to.be.true;

            const withdrawTx = await wallet.withdraw({
                token: L2_ERC20_ADDR,
                amount: withdraw_amount,
            });
            expect(withdrawTx).not.to.be.null;

            await withdrawTx.waitFinalize();
            const finalizeWithdrawTx = await wallet.finalizeWithdrawal(withdrawTx.hash);
            const result = await finalizeWithdrawTx.wait();
            expect(result).not.to.be.null;

            const w1_l2_DAI_balance_new = await wallet.getBalance(L2_ERC20_ADDR);
            console.log("w1_l2_DAI_balance after deposit: ", ethers.utils.formatEther(w1_l2_DAI_balance_new));
            const w1_l1_DAI_balance_new = await wallet.getBalanceL1(DAI_ADDRESS);
            console.log("w1_l1_DAI_balance after deposit:", ethers.utils.formatEther(w1_l1_DAI_balance_new));
            const w1_l2_base_token_balance_new = await wallet.getBalance(BASE_TOKEN_ADDR);
            console.log(
                "w2_l2_BASE_TOKEN_balance: after deposit",
                ethers.utils.formatEther(w1_l2_base_token_balance_new),
            );

            expect(w1_l2_DAI_balance.sub(w1_l2_DAI_balance_new)).to.be.equal(withdraw_amount);
            expect(w1_l1_DAI_balance_new.sub(w1_l1_DAI_balance)).to.be.equal(withdraw_amount);
            expect(w1_l2_base_token_balance.sub(w1_l2_base_token_balance_new) > BigNumber.from(0)).to.be.true;
        }).timeout(testTimeout);
    });

    // describe("#depositFee()", async () => {
    //     it("should estimates the DAI token deposit fee", async () => {
    //         const deposit_amount = ethers.utils.parseEther("1");
    //         const tx = {
    //             token: DAI_ADDRESS,
    //             amount: deposit_amount,
    //             to: await wallet.getAddress(),
    //             approveERC20: true,
    //             refundRecipient: await wallet.getAddress(),
    //         };

    //         const fee = await wallet.getFullRequiredDepositFee(tx);
    //         expect(fee).not.to.be.null;
    //     }).timeout(testTimeout);
    // });
});
