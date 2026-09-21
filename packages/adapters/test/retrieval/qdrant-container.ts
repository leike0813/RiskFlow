import { GenericContainer, Wait } from "testcontainers";

/**
 * 固定 Qdrant 1.19.0 真实服务夹具（design D10）。
 * 默认启动 digest 锁定的 Testcontainers 容器；设置 `RISKFLOW_QDRANT_URL` 时连接运维提供的
 * 同版本真实 endpoint。两条路径都必须报告 1.19.0，否则夹具失败——验收不允许降级到其他版本。
 */

export const QDRANT_TEST_IMAGE =
  "qdrant/qdrant:v1.19.0@sha256:057ee3a8da769fe7310dd3537b4dc7583bf87a95ce8ac43c0af5a46bc580d1fc";

export const QDRANT_TEST_PORT = 6333;

export const QDRANT_TEST_SERVICE_VERSION = "1.19.0";

export interface QdrantRetrievalFixture {
  readonly baseUrl: string;
  readonly serviceVersion: string;
  /** 本次夹具实际走的路径：真实容器或既有 endpoint。 */
  readonly endpoint: "container" | "external";
  stop(): Promise<void>;
}

const readServiceVersion = async (baseUrl: string): Promise<string> => {
  const response = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`qdrant endpoint ${baseUrl} returned HTTP ${response.status}`);
  const body: unknown = await response.json();
  const version =
    typeof body === "object" && body !== null
      ? (body as Readonly<Record<string, unknown>>)["version"]
      : undefined;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`qdrant endpoint ${baseUrl} did not report a service version`);
  }
  if (version !== QDRANT_TEST_SERVICE_VERSION) {
    throw new Error(
      `qdrant endpoint ${baseUrl} reports ${version}, expected ${QDRANT_TEST_SERVICE_VERSION}`,
    );
  }
  return version;
};

export const startQdrantRetrievalFixture = async (): Promise<QdrantRetrievalFixture> => {
  const externalUrl = process.env["RISKFLOW_QDRANT_URL"];
  if (externalUrl !== undefined && externalUrl.length > 0) {
    const baseUrl = externalUrl.replace(/\/+$/u, "");
    return {
      baseUrl,
      serviceVersion: await readServiceVersion(baseUrl),
      endpoint: "external",
      async stop(): Promise<void> {},
    };
  }

  const started = await new GenericContainer(QDRANT_TEST_IMAGE)
    .withExposedPorts(QDRANT_TEST_PORT)
    .withWaitStrategy(Wait.forHttp("/", QDRANT_TEST_PORT).forStatusCode(200))
    .withStartupTimeout(120_000)
    .start();
  const baseUrl = `http://${started.getHost()}:${started.getMappedPort(QDRANT_TEST_PORT)}`;
  try {
    const serviceVersion = await readServiceVersion(baseUrl);
    return {
      baseUrl,
      serviceVersion,
      endpoint: "container",
      async stop(): Promise<void> {
        await started.stop();
      },
    };
  } catch (error) {
    await started.stop().catch(() => undefined);
    throw error;
  }
};
