import { IBlock, Managed } from "@flarenetwork/mcc";
import { LiteBlock } from "@flarenetwork/mcc/dist/src/base-objects/blocks/LiteBlock";
import { AttLogger } from "../utils/logger";
import { getRetryFailureCallback, retry, retryMany } from "../utils/PromiseTimeout";
import { sleepms } from "../utils/utils";
import { Indexer } from "./indexer";

/**
 * Manages the block header collection on a blockchain.
 */
@Managed()
export class HeaderCollector {
  private indexer: Indexer;

  private logger: AttLogger;

  private blockHeaderHash = new Set<string>();
  private blockHeaderNumber = new Set<number>();
  private blockNumberHash = new Map<number, string>();

  constructor(logger: AttLogger, indexer: Indexer) {
    this.logger = logger;
    this.indexer = indexer;
  }

  /////////////////////////////////////////////////////////////
  // caching
  /////////////////////////////////////////////////////////////

  private isBlockCached(block: IBlock) {
    return this.blockHeaderHash.has(block.stdBlockHash) && this.blockHeaderNumber.has(block.number);
  }

  private cacheBlock(block: IBlock) {
    this.blockHeaderHash.add(block.stdBlockHash);
    this.blockHeaderNumber.add(block.number);
    this.blockNumberHash.set(block.number, block.stdBlockHash);
  }

  /////////////////////////////////////////////////////////////
  // saving blocks
  /////////////////////////////////////////////////////////////

  /**
   * Saves block headers in the range of block numbers. It is used on chains without
   * forks.
   * @param fromBlockNumber starting block number (included, should be greater than N on indexer)
   * @param toBlockNumberInc ending block number (included)
   */
  public async readAndSaveBlocksHeaders(fromBlockNumber: number, toBlockNumberInc: number) {
    // assert - this should never happen
    if(fromBlockNumber <= this.indexer.N) {
      let onFailure = getRetryFailureCallback();
      onFailure("saveBlocksHeaders: fromBlock too low");
      // this should exit the program
    }
    const blockPromisses = [];

    for (let blockNumber = fromBlockNumber; blockNumber <= toBlockNumberInc; blockNumber++) {
      // if rawUnforkable then we can skip block numbers if they are already written
      if (this.indexer.chainConfig.blockCollecting === "rawUnforkable") {
        if (this.blockHeaderNumber.has(blockNumber)) {
          continue;
        }
      }

      blockPromisses.push(async () => this.indexer.getBlock(`saveBlocksHeaders`, blockNumber));
    }

    const blocks = (await retryMany(`saveBlocksHeaders`, blockPromisses, 5000, 5)) as IBlock[];

    await this.saveBlocksOrHeadersOnNewTips(blocks);
  }

  /**
   * Saves blocks or headers in the array, if block.number > N.
   * Block numbers <= N are ignored.
   * Note that for case of non-forkable chains it caches mapping 
   * from block number to block (header). This mapping (`blockNumberHash`)
   * should not be used with forkable chains.
   * @param blocks array of headers
   * @returns 
   */
  public async saveBlocksOrHeadersOnNewTips(blocks: IBlock[]) {
    let blocksText = "[";

    const dbBlocks = [];

    for (const block of blocks) {
      if (!block || !block.stdBlockHash) continue;

      const blockNumber = block.number;

      // check cache
      if (this.isBlockCached(block)) {
        // cached
        blocksText += "^G" + blockNumber.toString() + "^^,";
        continue;
      } else {
        // new
        blocksText += blockNumber.toString() + ",";
      }

      // TODO: The cache is irrelevant, if not on the main fork
      this.cacheBlock(block);

      const dbBlock = new this.indexer.dbBlockClass();

      dbBlock.blockNumber = blockNumber;
      dbBlock.blockHash = block.stdBlockHash;
      dbBlock.timestamp = block.unixTimestamp;

      dbBlocks.push(dbBlock);
    }

    // remove all blockNumbers <= N+1
    while (dbBlocks.length > 0 && dbBlocks[0].blockNumber <= this.indexer.N + 1) {
      dbBlocks.splice(0, 1);
    }

    if (dbBlocks.length === 0) {
      //this.logger.debug(`write block headers (no new blocks)`);
      return;
    }

    this.logger.debug(`write block headers ${blocksText}]`);

    await retry(`saveBlocksHeadersArray`, async () => await this.indexer.dbService.manager.save(dbBlocks));
  }

  /////////////////////////////////////////////////////////////
  // save state
  /////////////////////////////////////////////////////////////
  /**
   * Saves the last top height into the database state
   * @param T top height
   */
  private async writeT(T: number) {
    // every update save last T
    const stateTcheckTime = this.indexer.getStateEntry("T", T);

    await retry(`writeT`, async () => await this.indexer.dbService.manager.save(stateTcheckTime));
  }

  /////////////////////////////////////////////////////////////
  // header collectors
  /////////////////////////////////////////////////////////////

  /**
   * Collects blocks (headers) on non-forkable chains
   */
  async runBlockHeaderCollectingRaw() {
    let localN = this.indexer.N;
    let localBlockNp1hash = "";

    // add initial number
    this.blockHeaderNumber.add(localN);

    while (true) {
      // get chain top block
      const localT = await this.indexer.getBlockHeight(`runBlockHeaderCollectingRaw`);
      const blockNp1 = (await this.indexer.getBlock(`runBlockHeaderCollectingRaw1`, localN + 1)) as IBlock;

      // has N+1 confirmation block
      const isNewBlock = localN < localT - this.indexer.chainConfig.numberOfConfirmations;
      const isChangedNp1Hash = localBlockNp1hash !== blockNp1.stdBlockHash;

      await this.writeT(localT);

      // check if N + 1 hash is the same
      if (!isNewBlock && !isChangedNp1Hash) {
        await sleepms(this.indexer.config.blockCollectTimeMs);
        continue;
      }

      // reads and saves block headers N+1 ... T
      // caches read blocks
      // TODO: we read the block N + 1 again - optimize
      await this.readAndSaveBlocksHeaders(localN + 1, localT);

      while (localN < localT - this.indexer.chainConfig.numberOfConfirmations) {
        if (this.blockHeaderNumber.has(localN)) {
          this.logger.debug2(`runBlockCollector N=${localN}++`);

          localN++;
          await sleepms(100);
          continue;
        }
        break;
      }

      this.logger.debug1(`runBlockCollector final N=${localN}`);

      localBlockNp1hash = this.blockNumberHash.get(localN);
    }
  }

  /**
   * Collects block headers on forkable (PoW/UTXO) chains and saves them into the database
   */
  async runBlockHeaderCollectingTips() {
    while (true) {
      // get chain top block
      const localT = await this.indexer.getBlockHeight(`runBlockHeaderCollectingRaw`);

      await this.writeT(localT);

      const blocks: LiteBlock[] = await this.indexer.cachedClient.client.getTopLiteBlocks(this.indexer.chainConfig.numberOfConfirmations);

      await this.saveBlocksOrHeadersOnNewTips(blocks);

      await sleepms(100);
    }
  }

  async runBlockHeaderCollecting() {
    switch (this.indexer.chainConfig.blockCollecting) {
      case "raw":
      case "latestBlock":
      case "rawUnforkable":
        this.runBlockHeaderCollectingRaw();
        break;
      case "tips":
        this.runBlockHeaderCollectingTips();
        break;
    }
  }
}
