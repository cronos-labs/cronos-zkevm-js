/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import { Contract, Signer } from "ethers";
import { Provider } from "@ethersproject/providers";

import type { IL2Bridge } from "./IL2Bridge";

export class IL2BridgeFactory {
  static connect(
    address: string,
    signerOrProvider: Signer | Provider
  ): IL2Bridge {
    return new Contract(address, _abi, signerOrProvider) as IL2Bridge;
  }
}

const _abi = [
  {
    inputs: [
      {
        internalType: "address",
        name: "_l1Sender",
        type: "address",
      },
      {
        internalType: "address",
        name: "_l2Receiver",
        type: "address",
      },
      {
        internalType: "address",
        name: "_l1Token",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "_amount",
        type: "uint256",
      },
      {
        internalType: "bytes",
        name: "_data",
        type: "bytes",
      },
    ],
    name: "finalizeDeposit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_l1Bridge",
        type: "address",
      },
      {
        internalType: "bytes32",
        name: "_l2TokenProxyBytecodeHash",
        type: "bytes32",
      },
      {
        internalType: "address",
        name: "_governor",
        type: "address",
      },
    ],
    name: "initialize",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "l1Bridge",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_l2Token",
        type: "address",
      },
    ],
    name: "l1TokenAddress",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_l1Token",
        type: "address",
      },
    ],
    name: "l2TokenAddress",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_l1Receiver",
        type: "address",
      },
      {
        internalType: "address",
        name: "_l2Token",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "_amount",
        type: "uint256",
      },
    ],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];
