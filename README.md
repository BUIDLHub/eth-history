# eth-history
Utility for retrieving/replaying historical blocks/events for a specific contract address.

# Motivation
Sometimes it's good to have a simple utility that recovers historical block and/or event data in a robust way. This utility will retrieve all blocks/events in the requested range and make retries upon failure or empty results. This is useful when using Infura or other managed RPC platform where failures and/or timeouts are common.

# Installation
npm install eth-history

# Usage
```javascript
let hist = new ETHHistory({
    web3: <web3-instance>,
    targetAddress: <contract_address>,
    abi: <abi array>
});

let cb = async (e, block) => {
   //log error or handle recovered block
}

//upon completion, callback should have been given all recovered blocks
await hist.recoverBlocks({
   fromBlock: <starting block number>,
   toBlock: <end block number>
}, cb);
```
