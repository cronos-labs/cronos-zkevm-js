#!/bin/bash

cd `dirname $0`

cp -f $ZKSYNC_HOME/contracts/ethereum/typechain/{IZkSync,IL2Bridge,IL1Bridge,IERC20Metadata,IAllowList,CronosTestnet}.d.ts .
cp -f $ZKSYNC_HOME/contracts/ethereum/typechain/{IZkSync,IL2Bridge,IL1Bridge,IERC20Metadata,IAllowList,CronosTestnet}Factory.ts .
