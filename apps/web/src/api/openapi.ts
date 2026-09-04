export type OpenApiMethodV1 = "GET" | "POST";

export type OpenApiRouteKeyV1 = Readonly<{
  method: OpenApiMethodV1;
  normalizedPath: string;
}>;

export type OpenApiAvailabilityV1 = Readonly<{
  routes: readonly OpenApiRouteKeyV1[];
}>;

type OpenApiOperationLikeV1 = Readonly<{
  method: OpenApiMethodV1;
  path: string;
}>;

type C09OperationRegistryLikeV1 = Readonly<{
  operations: readonly OpenApiOperationLikeV1[];
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const safePath = (value: unknown): string | undefined => {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.includes("://") ||
    value.includes("\\") ||
    value.includes("%") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes("//") ||
    value.includes("..")
  )
    return undefined;
  const normalized = value.replaceAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, ":$1");
  if (normalized.includes("{") || normalized.includes("}")) return undefined;
  const segments = normalized.split("/").slice(1);
  if (
    segments.some(
      (segment) => segment === "" || !/^(?::[A-Za-z][A-Za-z0-9_]*|[A-Za-z0-9._-]+)$/.test(segment),
    )
  )
    return undefined;
  return normalized;
};

export const normalizeOpenApiPath = (value: unknown): string | undefined => safePath(value);

export const deriveOpenApiAvailability = (document: unknown): OpenApiAvailabilityV1 => {
  if (!isRecord(document) || !isRecord(document.paths)) return Object.freeze({ routes: [] });
  const routes: OpenApiRouteKeyV1[] = [];
  const seen = new Set<string>();
  for (const [path, operations] of Object.entries(document.paths)) {
    const normalizedPath = safePath(path);
    if (normalizedPath === undefined || !isRecord(operations)) continue;
    for (const method of ["get", "post"] as const) {
      if (!Object.hasOwn(operations, method)) continue;
      const key = `${method.toUpperCase()} ${normalizedPath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      routes.push(
        Object.freeze({ method: method.toUpperCase() as OpenApiMethodV1, normalizedPath }),
      );
    }
  }
  return Object.freeze({ routes: Object.freeze(routes) });
};

export const hasOpenApiRoute = (
  availability: OpenApiAvailabilityV1,
  method: OpenApiMethodV1,
  path: string,
): boolean =>
  availability.routes.some((route) => route.method === method && route.normalizedPath === path);

export const isOperationAvailable = (
  operation: OpenApiOperationLikeV1,
  availability: OpenApiAvailabilityV1,
): boolean => hasOpenApiRoute(availability, operation.method, operation.path);

export const intersectOperationAvailability = <TOperation extends OpenApiOperationLikeV1>(
  operations: C09OperationRegistryLikeV1 | readonly TOperation[],
  availability: OpenApiAvailabilityV1,
): readonly TOperation[] => {
  const values: readonly TOperation[] =
    "operations" in operations
      ? (operations.operations as unknown as readonly TOperation[])
      : operations;
  return Object.freeze(values.filter((operation) => isOperationAvailable(operation, availability)));
};

export const openApiRouteKey = (route: OpenApiRouteKeyV1): string =>
  `${route.method} ${route.normalizedPath}`;
