import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/yaml";

interface Step {
  uses?: string;
  run?: string;
  with?: Record<string, string>;
}

interface Job {
  uses?: string;
  needs?: string | string[];
  if?: string;
  steps?: Step[];
  strategy?: { matrix: { package: string[] } };
}

interface Workflow {
  on: Record<string, { branches?: string[] } | null>;
  jobs: Record<string, Job>;
}

function workflow(name: string): Workflow {
  return parse(
    Deno.readTextFileSync(new URL(`./${name}.yml`, import.meta.url)),
  ) as Workflow;
}

Deno.test("la CI couvre les PR, main et les appels du workflow de publication", () => {
  const tests = workflow("test");
  assert("pull_request" in tests.on);
  assertEquals(tests.on.push?.branches, ["main"]);
  assert("workflow_call" in tests.on);

  const steps = Object.values(tests.jobs).flatMap((job) => job.steps ?? []);
  assert(steps.some((step) => step.run === "deno fmt --check"));
  assert(steps.some((step) => step.run === "deno lint"));
  const publish = workflow("publish");
  const versions = Object.values(publish.jobs)
    .flatMap((job) => job.steps ?? [])
    .filter((step) => step.uses === "denoland/setup-deno@v2")
    .map((step) => step.with?.["deno-version"]);
  assert(versions.length > 0);
  for (
    const step of steps.filter((step) =>
      step.uses?.startsWith("denoland/setup-deno@")
    )
  ) {
    assertEquals(step.with?.["deno-version"], versions[0]);
  }
});

Deno.test("la matrice exécute check et test pour tous les membres du workspace", () => {
  const root = new URL("../../deno.json", import.meta.url);
  const members: string[] = JSON.parse(Deno.readTextFileSync(root)).workspace;
  const job = workflow("test").jobs.packages;
  assertEquals(
    job.strategy?.matrix.package.toSorted(),
    members.map((member) => member.replace(/^\.\//, "")).toSorted(),
  );
  for (const member of members) {
    const config = JSON.parse(
      Deno.readTextFileSync(new URL(`${member}/deno.json`, root)),
    );
    for (const task of ["check", "test"]) {
      assert(task in config.tasks, `${member} ne déclare pas ${task}`);
      assert(job.steps?.some((step) => step.run === `deno task ${task}`));
    }
  }
});

Deno.test("chaque publication attend les tests réutilisés depuis le même commit", () => {
  const publish = workflow("publish");
  assertEquals(publish.jobs.tests?.uses, "./.github/workflows/test.yml");
  assertEquals(publish.jobs.tests.if, undefined);
  for (const [name, job] of Object.entries(publish.jobs)) {
    if (!name.startsWith("publish-")) continue;
    const needs = typeof job.needs === "string" ? [job.needs] : job.needs ?? [];
    assert(
      needs.includes("tests"),
      `${name} peut publier sans attendre les tests`,
    );
    assertEquals(
      job.if,
      undefined,
      `${name} doit conserver la condition de succès par défaut`,
    );
  }
});
