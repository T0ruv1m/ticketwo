import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { Store } from "../src/domain/store.ts";
import { projectFrom } from "../src/server/app.ts";
import { Sessions } from "../src/server/sessions.ts";
import { DEFAULT_PROJECT } from "../src/shared/picklists.ts";
import { FakeComposer } from "./helpers.ts";

function reqWithCookie(cookie?: string): Request {
  return { headers: cookie ? { cookie } : {} } as unknown as Request;
}

describe("project sessions", () => {
  it("gives each project its own board", () => {
    const sessions = new Sessions(() => new Store({ composer: new FakeComposer() }));
    const farmacis = sessions.forProject("FARMACIS");
    const medicamentos = sessions.forProject("MEDICAMENTOS");
    farmacis.addGroup({ id: "G1", project: "FARMACIS", totalVolumes: 2 });
    medicamentos.addGroup({ id: "G2", project: "MEDICAMENTOS", totalVolumes: 3 });

    expect(farmacis.board().tickets.map((t) => t.groupId)).toEqual(["G1", "G1"]);
    expect(medicamentos.board().tickets.map((t) => t.groupId)).toEqual(["G2", "G2", "G2"]);
    expect(sessions.forProject("FARMACIS")).toBe(farmacis);
  });

  it("resolves the project from the cookie, rejecting unknown values", () => {
    expect(projectFrom(reqWithCookie())).toBe(DEFAULT_PROJECT);
    expect(projectFrom(reqWithCookie("project=FARMACIS"))).toBe("FARMACIS");
    expect(projectFrom(reqWithCookie("project=E-MARKET%20PLACE"))).toBe("E-MARKET PLACE");
    expect(projectFrom(reqWithCookie("project=nope"))).toBe(DEFAULT_PROJECT);
    expect(projectFrom(reqWithCookie("other=1; project=MMH; x=2"))).toBe("MMH");
  });

  it("reset clears every project board", () => {
    const sessions = new Sessions(() => new Store({ composer: new FakeComposer() }));
    sessions.forProject("FARMACIS").addGroup({ id: "G1", project: "FARMACIS", totalVolumes: 2 });
    sessions.reset();
    expect(sessions.forProject("FARMACIS").board().tickets).toHaveLength(0);
  });
});
