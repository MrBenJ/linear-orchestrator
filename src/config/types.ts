import { z } from "zod";

export const projectMappingSchema = z.object({
  linearProjectId: z.string(),
  repoPath: z.string(),
});

export const stateMapSchema = z.object({
  inProgress: z.string(),
  inReview: z.string(),
  done: z.string(),
});

export const teamMappingSchema = z.object({
  linearTeamId: z.string(),
  stateMap: stateMapSchema,
});

export const orchestrationLabelsSchema = z.object({
  needsHuman: z.string().default("lo:needs-human"),
});

export const configSchema = z.object({
  concurrencyCap: z.number().int().positive().default(2),
  defaultRunTimeoutMs: z.number().int().positive().default(3_600_000),
  heartbeatIntervalMs: z.number().int().positive().default(300_000),
  heartbeatGraceMs: z.number().int().positive().default(600_000),
  projectMappings: z.array(projectMappingSchema).default([]),
  teamMappings: z.array(teamMappingSchema).default([]),
  orchestrationLabels: orchestrationLabelsSchema.default({ needsHuman: "lo:needs-human" }),
});

export type Config = z.infer<typeof configSchema>;
export type StateMap = z.infer<typeof stateMapSchema>;
export type ProjectMapping = z.infer<typeof projectMappingSchema>;
export type TeamMapping = z.infer<typeof teamMappingSchema>;
