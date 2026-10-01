import { Storage, Bucket } from "@google-cloud/storage";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Writable } from "node:stream";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

export interface GcsUploadResult {
  bucket: string;
  objectPath: string;
  size?: number | undefined;
  contentType?: string | undefined;
}

export class GCSService {
  private readonly storage: Storage;
  private readonly bucketName: string;

  constructor(bucketName: string = env.gcs.bucketName, projectId?: string) {
    this.bucketName = bucketName;

    const effectiveProjectId = projectId || env.gcs.projectId;
    this.storage = effectiveProjectId
      ? new Storage({ projectId: effectiveProjectId })
      : new Storage();
  }

  public isConfigured(): boolean {
    return Boolean(this.bucketName && this.bucketName.trim().length > 0);
  }

  public getBucket(): Bucket {
    if (!this.bucketName) {
      throw new Error(
        "GCS bucket name is not configured. Please set GCS_BUCKET_NAME in your .env file.",
      );
    }
    return this.storage.bucket(this.bucketName);
  }

  public generateObjectPath(
    originalFilename?: string,
    prefix: string = "orders/uploads",
  ): string {
    const today = new Date().toISOString().split("T")[0];
    const uniqueId = randomUUID();
    const ext = originalFilename ? path.extname(originalFilename) : ".csv";
    const cleanExt = ext.startsWith(".") ? ext : `.${ext}`;

    return `${prefix}/${today}-${uniqueId}${cleanExt}`;
  }

  public async uploadBuffer(
    buffer: Buffer,
    destination: string,
    contentType: string = "text/plain",
  ): Promise<GcsUploadResult> {
    const bucket = this.getBucket();
    const file = bucket.file(destination);

    logger.info(
      { destination, sizeBytes: buffer.length, bucket: this.bucketName },
      "GCS upload started",
    );

    try {
      await file.save(buffer, {
        contentType,
        resumable: false,
        metadata: {
          contentType,
        },
      });

      logger.info(
        { destination, bucket: this.bucketName },
        "GCS upload completed successfully",
      );

      return {
        bucket: this.bucketName,
        objectPath: destination,
        size: buffer.length,
        contentType,
      };
    } catch (error: any) {
      logger.error({ destination, err: error }, "GCS upload failed");
      throw this.normalizeGcsError(error);
    }
  }
  
  public createUploadStream(
    destination: string,
    contentType: string = "text/csv",
  ): { writeStream: Writable; promise: Promise<GcsUploadResult> } {
    const bucket = this.getBucket();
    const file = bucket.file(destination);

    const writeStream = file.createWriteStream({
      resumable: false,
      contentType,
      metadata: {
        contentType,
      },
    });

    const promise = new Promise<GcsUploadResult>((resolve, reject) => {
      writeStream.on("finish", () => {
        logger.info(
          { destination, bucket: this.bucketName },
          "GCS stream upload finished",
        );
        resolve({
          bucket: this.bucketName,
          objectPath: destination,
          contentType,
        });
      });

      writeStream.on("error", (err) => {
        logger.error({ destination, err }, "GCS stream upload error");
        reject(this.normalizeGcsError(err));
      });
    });

    return { writeStream, promise };
  }

  public async verifyBucketAccess(): Promise<boolean> {
    try {
      const bucket = this.getBucket();
      const [exists] = await bucket.exists();
      if (!exists) {
        logger.warn(
          { bucket: this.bucketName },
          "GCS bucket does not exist or is not accessible",
        );
        return false;
      }
      logger.info({ bucket: this.bucketName }, "Verified GCS bucket access");
      return true;
    } catch (error: any) {
      logger.error(
        { err: error, bucket: this.bucketName },
        "Failed to verify GCS bucket access",
      );
      return false;
    }
  }

  private normalizeGcsError(error: any): Error {
    const code = error?.code || error?.status;
    const message = error?.message || "Unknown Google Cloud Storage error";

    if (code === 404 || message.includes("Not Found")) {
      return new Error(`GCS Bucket "${this.bucketName}" or object not found.`);
    }
    if (
      code === 403 ||
      message.includes("caller does not have storage.objects")
    ) {
      return new Error(
        `Permission denied: ADC identity lacks permission for bucket "${this.bucketName}".`,
      );
    }
    if (message.includes("Could not load the default credentials")) {
      return new Error(
        "ADC not configured. Please run `gcloud auth application-default login` on your machine.",
      );
    }
    return new Error(`GCS Error: ${message}`);
  }
}

export const gcsService = new GCSService();
