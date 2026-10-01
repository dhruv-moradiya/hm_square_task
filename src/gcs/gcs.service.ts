import { Storage, Bucket } from "@google-cloud/storage";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { env } from "../config/env.js";

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
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const uniqueId = randomUUID();
    const ext = originalFilename ? path.extname(originalFilename) : ".txt";
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

    console.log(
      `[GCS] Upload started: ${destination} (${buffer.length} bytes) to bucket "${this.bucketName}"`,
    );

    try {
      await file.save(buffer, {
        contentType,
        resumable: false,
        metadata: {
          contentType,
        },
      });

      console.log(`[GCS] Upload completed successfully: ${destination}`);

      return {
        bucket: this.bucketName,
        objectPath: destination,
        size: buffer.length,
        contentType,
      };
    } catch (error: any) {
      console.error(
        `[GCS] Upload failed for ${destination}:`,
        error?.message || error,
      );
      throw this.normalizeGcsError(error);
    }
  }

  public async uploadFile(
    localFilePath: string,
    destination: string,
    contentType?: string,
  ): Promise<GcsUploadResult> {
    const bucket = this.getBucket();

    console.log(
      `[GCS] Uploading local file "${localFilePath}" to "${destination}" in bucket "${this.bucketName}"`,
    );

    try {
      const uploadOptions: {
        destination: string;
        contentType?: string;
        resumable: boolean;
      } = {
        destination,
        resumable: false,
      };
      if (contentType) {
        uploadOptions.contentType = contentType;
      }

      await bucket.upload(localFilePath, uploadOptions);

      console.log(`[GCS] File upload completed: ${destination}`);

      return {
        bucket: this.bucketName,
        objectPath: destination,
        contentType: contentType || undefined,
      };
    } catch (error: any) {
      console.error(
        `[GCS] File upload failed for ${destination}:`,
        error?.message || error,
      );
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
        console.log(`[GCS] Stream upload finished: ${destination}`);
        resolve({
          bucket: this.bucketName,
          objectPath: destination,
          contentType,
        });
      });

      writeStream.on("error", (err) => {
        console.error(
          `[GCS] Stream upload error on ${destination}:`,
          err.message,
        );
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
        console.warn(
          `[GCS] Warning: Bucket "${this.bucketName}" does not exist or is not accessible.`,
        );
        return false;
      }
      console.log(`[GCS] Verified bucket access: "${this.bucketName}"`);
      return true;
    } catch (error: any) {
      console.error(
        `[GCS] Failed to verify bucket access:`,
        error?.message || error,
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
