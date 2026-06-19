import { Storage } from "@google-cloud/storage";

export interface ResultArtifactStoreLike {
  put(jobId: string, content: string): Promise<string | null>;
}

export class CloudStorageResultArtifactStore implements ResultArtifactStoreLike {
  constructor(private readonly bucketName: string, private readonly storage = new Storage()) {}

  async put(jobId: string, content: string): Promise<string | null> {
    if (!content) return null;
    const objectName = `result-artifacts/${jobId}.txt`;
    await this.storage.bucket(this.bucketName).file(objectName).save(Buffer.from(content, "utf8"), {
      resumable: false,
      contentType: "text/plain; charset=utf-8",
      metadata: { cacheControl: "no-store" },
    });
    return objectName;
  }
}
