import { expect } from "chai";
import { Provider, types, Wallet } from "../src";
import { ethers } from "ethers";
import { sleep } from "../src/utils";
import { Address } from "../src/types";

const mnemonic = "stuff slice staff easily soup parent arm payment cotton trade scatter struggle";
const mnemonic2 = "test test test test test test test test test test test junk";
const testTimeout = 30_000;
const provider = Provider.getDefaultProvider(types.Network.Localhost) as Provider;
const ethProvider = ethers.getDefaultProvider("http://127.0.0.1:8545");

describe("BaseToken", () => {
    let mnemonicWallet = ethers.Wallet.fromPhrase(mnemonic);
    let mnemonicWallet2 = ethers.Wallet.fromPhrase(mnemonic2);

    const wallet = new Wallet(mnemonicWallet.privateKey, provider, ethProvider);
    const wallet2 = new Wallet(mnemonicWallet2.privateKey, provider, ethProvider);
    let BASE_TOKEN_ADDR: Address;

    before("setup", async function () {
        BASE_TOKEN_ADDR = await wallet.baseTokenAddress();
    });

    describe("#deposit()", async () => {
        it("should deposit L1 balance to L2", async () => {
            console.log("wallet address", await wallet.getAddress());
            const l1_balance = await wallet.getBalanceL1(BASE_TOKEN_ADDR);
            console.log("w1_l1_balance: ", ethers.formatEther(l1_balance));
            console.log("w1_l2_balance: ", ethers.formatEther(await wallet.getBalance(BASE_TOKEN_ADDR)));
            console.log("w1_l1_ETH_balance: ", ethers.formatEther(await wallet.getBalanceL1()));
            const deposit_amount = ethers.parseEther("1.0");
            const deposit = await wallet.deposit({
                token: BASE_TOKEN_ADDR,
                amount: deposit_amount,
            });
            expect(deposit).not.to.be.null;

            const receipt = await deposit.waitFinalize();
            expect(receipt).not.to.be.null;

            const l1_balance_new = await wallet.getBalanceL1(BASE_TOKEN_ADDR);
            console.log("w1_l1_balance after deposit: ", ethers.formatEther(l1_balance_new));
            console.log("w1_l1_ETH_balance after deposit: ", ethers.formatEther(await wallet.getBalanceL1()));
            expect(l1_balance - l1_balance_new).to.be.equal(deposit_amount);
            console.log(
                "w1_l2_balance after deposit: ",
                ethers.formatEther(await wallet.getBalance(BASE_TOKEN_ADDR)),
            );
        }).timeout(testTimeout);
    });

    describe("#transfer()", () => {
        it("should transfer L2 balance", async () => {
            console.log("w1_l2_balance: ", ethers.formatEther(await wallet.getBalance(BASE_TOKEN_ADDR)));

            const l2_balance = await wallet2.getBalance(BASE_TOKEN_ADDR);
            console.log("w2_l2_balance: ", ethers.formatEther(l2_balance));

            const transfer_amount = ethers.parseEther("0.1");
            const transfer = await wallet.transfer({
                to: await wallet2.getAddress(),
                token: BASE_TOKEN_ADDR,
                amount: transfer_amount,
            });
            expect(transfer).not.to.be.null;

            while ((await transfer.confirmations()) < 1) {
                await sleep(100);
            }

            console.log(
                "w1_l2_balance after transfer: ",
                ethers.formatEther(await wallet.getBalance(BASE_TOKEN_ADDR)),
            );

            const l2_balance_new = await wallet2.getBalance(BASE_TOKEN_ADDR);
            console.log("w2_l2_balance after transfer: ", ethers.formatEther(l2_balance_new));
            expect(l2_balance_new - l2_balance).to.be.equal(transfer_amount);
        });
    });

    describe("#withdraw()", () => {
        it("should withdraw L2 balance to L1", async () => {
            const l1_balance = await wallet.getBalanceL1(BASE_TOKEN_ADDR);
            console.log("w2_l1_balance: ", ethers.formatEther(l1_balance));

            const l2_balance = await wallet.getBalance(BASE_TOKEN_ADDR);
            console.log("w2_l2_balance: ", ethers.formatEther(l2_balance));

            const withdraw_amount = ethers.parseEther("0.1");
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
            console.log("w2_l1_balance after withdraw: ", ethers.formatEther(l1_balance_new));

            const l2_balance_new = await wallet.getBalance(BASE_TOKEN_ADDR);
            console.log("w2_l2_balance after withdraw: ", ethers.formatEther(l2_balance_new));

            expect(l1_balance_new - l1_balance).to.be.equal(withdraw_amount);
        }).timeout(testTimeout);
    });
});
