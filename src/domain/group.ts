import { DomainError } from "./errors.ts";
import type { Group, Ticket } from "./types.ts";

export const MIN_VOLUMES = 1;
export const MAX_VOLUMES = 100000;
export const GRID_CAPACITY = 10;

export interface CreateGroupInput {
  id?: string;
  project: string;
  destination?: string;
  totalVolumes: number;
}

export function assertValidProject(project: unknown): asserts project is string {
  if (typeof project !== "string" || project.trim().length === 0) {
    throw new DomainError("invalid-project", "project must be a non-empty string");
  }
}

export function assertValidVolumes(totalVolumes: unknown): asserts totalVolumes is number {
  if (
    typeof totalVolumes !== "number" ||
    !Number.isInteger(totalVolumes) ||
    totalVolumes < MIN_VOLUMES ||
    totalVolumes > MAX_VOLUMES
  ) {
    throw new DomainError(
      "invalid-volumes",
      `totalVolumes must be an integer in ${MIN_VOLUMES}..${MAX_VOLUMES}`,
    );
  }
}

export function ticketId(groupId: string, volumeIndex: number | null): string {
  return `t:${groupId}:${volumeIndex === null ? "full" : volumeIndex}`;
}

export function buildGroup(input: CreateGroupInput, now: string): Group {
  assertValidProject(input.project);
  assertValidVolumes(input.totalVolumes);
  const id = input.id?.trim() ? input.id.trim() : generateGroupId();
  return {
    id,
    project: input.project.trim(),
    destination: (input.destination ?? "").trim(),
    totalVolumes: input.totalVolumes,
    createdAt: now,
  };
}

export function buildTickets(group: Group): Ticket[] {
  const base = {
    groupId: group.id,
    project: group.project,
    destination: group.destination,
    totalVolumes: group.totalVolumes,
    status: "pending" as const,
  };

  if (group.totalVolumes > GRID_CAPACITY) {
    return [
      {
        ...base,
        id: ticketId(group.id, null),
        kind: "full",
        volumeIndex: null,
      },
    ];
  }

  const tickets: Ticket[] = [];
  for (let volumeIndex = 1; volumeIndex <= group.totalVolumes; volumeIndex += 1) {
    tickets.push({
      ...base,
      id: ticketId(group.id, volumeIndex),
      kind: "grid",
      volumeIndex,
    });
  }
  return tickets;
}

let counter = 0;

export function generateGroupId(): string {
  counter += 1;
  return `G${Date.now().toString(36)}${counter.toString(36)}`;
}
