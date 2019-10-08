import * as yup from 'yup';
import ETHSync from 'eth-sync';
import Logger from './Logger';

const schema = yup.object({
    web3: yup.object().required("ETHHistory is missing web3"),
    abi: yup.array().min(1).required("ETHHistory missing ABI array for contract"),
    targetAddress: yup.string().required("ETHHistory is missing targetAddress")
});

const recoverBlockSchema = yup.object({
    fromBlock: yup.number().required("ETHHistory missing fromBlock for block recovery"),
    toBlock: yup.number(), //defaults to latest block 
    includeReceipts: yup.bool(), //defaults to false
    maxRetries: yup.number(), //defaults to 50 if undefined

    //number of concurrent requests to make at a time. Zero means run in sequence
    concurrency: yup.number() //defaults to 5 if undefined
});

const recoverEventsSchema = yup.object({
    fromBlock: yup.number().required("ETHHistory missing fromBlock for event recovery"),
    toBlock: yup.number(),//defaults to latest block 
})

const log = new Logger({component: "ETHHistory"});

export default class ETHHistory {
    constructor(props) {
        schema.validateSync(props);
        this.web3 = props.web3;
        this.targetAddress = props.targetAddress;
        this.abi = props.abi;
        [
            'recoverBlocks',
            'recoverEvents',
            '_processBlocks'
        ].forEach(fn=>this[fn]=this[fn].bind(this));
    }

    async recoverBlocks(props, cb) {
        
        recoverBlockSchema.validateSync(props);
        let {
            fromBlock,
            toBlock,
            includeReceipts,
            maxRetries,
            concurrency
        } = props;
        if(!toBlock) {
            toBlock = await this.web3.eth.getBlockNumber();
        }
        if(typeof maxRetries === 'undefined') {
            maxRetries = 50;
        }        
        if(typeof concurrency === 'undefined') {
            concurrency = 5;
        }
        let span = toBlock = fromBlock;
        if(span < 0) {
            throw new Error("Invalid block span. fromBlock must be before toBlock");
        }
        if(span < concurrency) {
            concurrency = 1;
        }

        log.info("Recovering blocks", fromBlock,"-",toBlock,"with",maxRetries,"failure retries in batches of",concurrency);
        let batch = [];
        for(let i=fromBlock;i<=toBlock; i+= concurrency) {
            let blocks = [];
            for(let j=0;j<concurrency;++j) {
                let ctx = {
                    tries: 0,
                    maxTries: maxRetries,
                    callback: async (e, b) => {
                        
                        if(e) {
                            log.error("Problem in block retrieval", e);
                            await cb(e);
                        } else {
                            log.debug("Received block", b.number);
                            blocks.push(b);
                        }
                    }
                };
                batch.push(execWithRetries(ctx, this.web3.eth.getBlock, i+j, true));
            }
            log.debug("Waiting on batch of", batch.length,"requests to complete...");
            await Promise.all(batch);
            batch = [];
            blocks.sort((a,b)=>a.timestamp-b.timestamp);
            log.debug("Processing blocks",blocks[0].number,"-",blocks[blocks.length-1].number);
            let keepGoing = await this._processBlocks({blocks, includeReceipts, concurrency, maxRetries}, cb);
            if(typeof keepGoing !== 'undefined' && !keepGoing) {
                log.debug("Bailing out of block retrieval early since processing told us to stop");
                return;
            }
        }
        log.info("Finished recovering all blocks");
    }

    recoverEvents(props, cb, badCallback) {
        
        recoverEventsSchema.validateSync(props);
        return new Promise(async (done)=>{
            try {

                let {
                    fromBlock,
                    toBlock
                } = props;
                let count = 0;

                if(!toBlock) {
                    toBlock = await this.web3.eth.getBlockNumber();
                }
               
                log.info("Syncing log events in range", fromBlock,"-",toBlock);
                let sync = new ETHSync({
                    web3Factory: ()=>this.web3,
                    address: this.targetAddress,
                    abi: this.abi
                });
    
                let txnHandler = async (e, txns) => {
                    if(e) {
                        log.error("Problem in event retrieval", e);
                        await cb(e);
                    } else {
                        log.debug("Received", txns.length,"event transactions");
                        count += txns.length;
                        await cb(null, txns);
                    }
                }

                let badHandler = null;
                if(typeof badCallback === 'function') {
                    badHandler = (badTxns) => {
                        return badCallback(badTxns);
                    }
                }
        
                let paging = async cursor => {
                    if(cursor) {
                        log.debug("Going to next batch of events");
                        cursor.nextBatch(txnHandler, badHandler).then(paging);
                    } else {
                        //all done
                        log.info("Finished receiving", count, "event transactions");
                        done();
                    }
                }
    
                sync.start({
                    fromBlock,
                    toBlock
                }, txnHandler, badHandler).then(paging);

            } catch (e) {
                log.error("Problem in event sync", e);
                await cb(e);
            }
        });
        

    }

    async _processBlocks(props, cb) {
        let {
            blocks,
            includeReceipts, 
            maxRetries,
            concurrency
        }  = props;
        let keepGoing = true;
        for(let i=0;i<blocks.length;++i) {
            let b = blocks[i];
            if(includeReceipts) {
                log.debug("Retrieving receipts for block", b.number);
                let s = Date.now();
                //this will be slow but user needs receipts...so here we go
                let batch = [];
                for(let j=0;j<b.transactions.length;++j) {
                    let txn = b.transactions[j];
                    let ctx = {
                        tries: 0,
                        maxTries: maxRetries,
                        callback: async (e, r) => {
                            if(e) {
                                log.error("Problem")
                                await cb(e);
                            } else {
                                txn.receipt = r;
                            }
                        }
                    };
                    batch.push(execWithRetries(ctx, this.web3.eth.getTransactionReceipt, txn.hash));
                    if(batch.length >= concurrency) {
                        await Promise.all(batch);
                        batch = [];
                    }
                }
                //any remaining items, wait for them
                if(batch.length > 0) {
                    await Promise.all(batch);
                }
                log.debug("Retrieved",b.transactions.length,"txns for block",b.number,"in", (Date.now()-s),"ms");
            }
            //all txns enriched, send to client
            let r = await cb(null, b);
            if(typeof r !== 'undefined') {
                keepGoing = r;
            }
            if(!keepGoing) {
                return keepGoing;
            }
        }
    }
}

const execWithRetries = async (ctx, fn, ...args) => {
    while(ctx.tries < ctx.maxTries) {
        try {
            ++ctx.tries;
            let r = await fn(...args);
            if(!r) {
                log.warn("No results in web3 call, will retry");
                await sleep(500);
            } else {
                return ctx.callback(null, r);
            }
        } catch (e) {
            
           if(ctx.tries < ctx.maxTries) {
                log.debug("Problem interacting with web3, will retry", e);
                await sleep(500);
           } else {
               return ctx.callback(e);
           }
        }
    }
    return ctx.callback(new Error("Could not execute with retries"));
}

const sleep = ms => {
    return new Promise(done=>{
        setTimeout(done, ms);
    });
}
