import Fastify, { type FastifyInstance } from "fastify";

export function buildApi(): FastifyInstance {
  return Fastify();
}
