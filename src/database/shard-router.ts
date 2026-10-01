import crypto from "node:crypto";

export class ShardRouter {
  private readonly shardCount: number;

  constructor(shardCount: number = 3) {
    if (shardCount <= 0) {
      throw new Error("shardCount must be a positive integer");
    }
    this.shardCount = shardCount;
  }

  // To get the shard for a customer
  public getShard(customerId: string): number {
    if (
      !customerId ||
      typeof customerId !== "string" ||
      customerId.trim().length === 0
    ) {
      throw new Error("customerId must be a non-empty string");
    }

    const normalizedCustomerId = customerId.trim();
    const hash = crypto
      .createHash("sha256")
      .update(normalizedCustomerId)
      .digest();

    const hashInt = hash.readUInt32BE(0);

    return hashInt % this.shardCount;
  }

  // To get the shard count
  public getShardCount(): number {
    return this.shardCount;
  }
}

export const shardRouter = new ShardRouter(3);
