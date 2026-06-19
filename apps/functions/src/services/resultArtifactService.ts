import { Storage } from "@google-cloud/storage";

export interface ResultArtifactServiceLike {
  read(objectName: string): Promise<Buffer>;
  delete(objectName: string): Promise<void>;
}

export class ResultArtifactService implements ResultArtifactServiceLike {
  constructor(private readonly bucketName: string, private readonly storage = new Storage()) {}

  async read(objectName: string): Promise<Buffer> {
    const [content] = await this.storage.bucket(this.bucketName).file(objectName).download();
    return content;
  }

  async delete(objectName: string): Promise<void> {
    await this.storage.bucket(this.bucketName).file(objectName).delete({ ignoreNotFound: true });
  }
}
