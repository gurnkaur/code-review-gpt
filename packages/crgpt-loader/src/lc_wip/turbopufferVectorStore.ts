import { Document } from "langchain/document";
import { Embeddings } from "langchain/embeddings/base";
import { VectorStore } from "langchain/vectorstores/base";

interface TurboPufferIntegrationParams {
  apiKey?: string;
  namespace?: string;
}

interface TurboPufferHeaders {
  headers: {
    Authorization: string;
    "Content-Type": string;
  };
}

enum TurboPufferDistanceMetric {
  Cosine = "cosine_distance",
  Euclidean = "euclidean_squared",
}

interface TurboPufferQueryResult {
  dist: number;
  id: number;
  vector: number[];
  attributes: Record<string, any>;
}

export class TurboPuffer extends VectorStore {
  get lc_secrets(): { [key: string]: string } {
    return {
      apiKey: "TURBOPUFFER_API_KEY",
    };
  }

  get lc_aliases(): { [key: string]: string } {
    return {
      apiKey: "turbopuffer_api_key",
    };
  }

  private apiKey: string;
  private namespace: string;
  private apiEndpoint = "https://api.turbopuffer.com/v1/";

  public _vectorstoreType(): string {
    return "turbopuffer";
  }

  constructor(
    embeddings: Embeddings,
    args: {
      apiKey?: string;
      namespace?: string;
    }
  ) {
    super(embeddings, args);

    const apiKey = args.apiKey ?? process.env["TURBOPUFFER_API_KEY"];
    if (!apiKey) {
      throw new Error("TurboPuffer api key is not provided.");
    }
    this.apiKey = apiKey;
    this.namespace = args.namespace ?? "default";
  }

  getJsonHeader(): TurboPufferHeaders {
    return {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
    };
  }

  async addVectors(
    vectors: number[][],
    documents: Document<Record<string, any>>[],
    options?: { ids?: number[] }
  ): Promise<void> {
    try {
      if (options?.ids && options.ids.length !== vectors.length) {
        throw new Error(
          "Number of ids provided does not match number of vectors"
        );
      }

      if (documents.length !== vectors.length) {
        throw new Error(
          "Number of documents provided does not match number of vectors"
        );
      }

      if (documents.length === 0) {
        throw new Error("No documents provided");
      }

      const docIds = options?.ids ?? documents.map((_, index) => index);

      const attributes = {
        source: documents.map((doc) => doc.metadata.source),
        pageContent: documents.map((doc) => doc.pageContent),
      };

      const data = {
        docIds,
        vectors,
        attributes,
      };

      await fetch(`${this.apiEndpoint}/vectors/${this.namespace}`, {
        method: "POST",
        headers: this.getJsonHeader().headers,
        body: JSON.stringify(data),
      });
    } catch (error) {
      console.error("Error storing vectors:", error);
      throw error;
    }
  }

  async addDocuments(
    documents: Document<Record<string, any>>[],
    options?: { ids?: number[] }
  ): Promise<void> {
    const vectors = await this.embeddings.embedDocuments(
      documents.map((doc) => doc.pageContent)
    );

    return this.addVectors(vectors, documents, options);
  }

  async queryVectors(
    query: number[],
    k: number,
    distanceMetric: TurboPufferDistanceMetric,
    includeAttributes?: string[],
    includeVector?: boolean,
    // See https://turbopuffer.com/docs/reference/query for more info
    filters?: Record<string, any>
  ): Promise<TurboPufferQueryResult[]> {
    const data = {
      query,
      k,
      distanceMetric,
      filters,
      includeAttributes,
      includeVector,
    };

    const response = await fetch(
      `${this.apiEndpoint}/vectors/${this.namespace}/query`,
      {
        method: "POST",
        headers: this.getJsonHeader().headers,
        body: JSON.stringify(data),
      }
    );

    const json = await response.json();

    return json.results;
  }

  async similaritySearchVectorWithScore(
    query: number[],
    k: number,
    filter?: Record<string, any>
  ): Promise<[Document, number][]> {
    const search = await this.queryVectors(
      query,
      k,
      TurboPufferDistanceMetric.Cosine,
      ["source", "pageContent"],
      false,
      filter
    );

    const result: [Document, number][] = search.map((res) => {
      return [
        new Document({
          pageContent: res.attributes.pageContent,
          metadata: {
            source: res.attributes.source,
          },
        }),
        res.dist,
      ];
    });

    return result;
  }

  static async fromDocuments(
    docs: Document[],
    embeddings: Embeddings,
    dbConfig: TurboPufferIntegrationParams
  ): Promise<TurboPuffer> {
    const instance = new this(embeddings, dbConfig);
    await instance.addDocuments(docs);
    return instance;
  }
}
