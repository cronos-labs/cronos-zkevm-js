import { expect } from "chai";
import { Provider, types, Wallet } from "../src";
import { ethers } from "ethers";

// This should be run first before all other tests,
// which is why it's specified first in the test command in package.json.
describe("setup", async () => {
    const CRO_ADDR = "0xd415716710ff28e4f40ba1882318c2e377f873ab";
    const mnemonic =
        "stuff slice staff easily soup parent arm payment cotton trade scatter struggle";
    const mnemonic2= "test test test test test test test test test test test junk";

    let mnemonicWallet = ethers.Wallet.fromPhrase(mnemonic);
    let mnemonicWallet2 = ethers.Wallet.fromPhrase(mnemonic2);
    
    const provider = Provider.getDefaultProvider(types.Network.Localhost) as Provider;
    const ethProvider = ethers.getDefaultProvider("http://127.0.0.1:8545");

    const wallet = new Wallet(mnemonicWallet.privateKey, provider, ethProvider);
    const wallet2 = new Wallet(mnemonicWallet2.privateKey, provider, ethProvider);

    describe("#deposit()", async () => {
        console.log("wallet address", await wallet.getAddress());
        console.log("w1_l2_balance: ", await wallet.getBalance(CRO_ADDR));
        const l1_balance = await wallet.getBalanceL1(CRO_ADDR);
        console.log("w1_l1_balance: ", ethers.formatEther(l1_balance));
        const deposit_amount = ethers.parseEther("1.0");
        const deposit = await wallet.deposit({
            token: CRO_ADDR,
            amount: deposit_amount,
        });
        expect(deposit).not.to.be.null;
    
        const receipt = await deposit.waitFinalize();
        expect(receipt).not.to.be.null;
        console.log("receipt:", receipt);

        const l1_balance_new = await wallet.getBalanceL1(CRO_ADDR);
        console.log("w1_l1_balance after deposit: ", ethers.formatEther(l1_balance_new));
        expect(l1_balance - l1_balance_new).to.be.equal(deposit_amount);
        console.log("w1_l2_balance after deposit: ", ethers.formatEther((await wallet.getBalance(CRO_ADDR))));
    });






});
