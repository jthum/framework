import { describe, expect, it } from "vite-plus/test";
import { render } from "svelte/server";
import type { RuleExecutionClient } from "@jthum/framework/client";
import type { ActorRequest, RuleExecutionDetails } from "@jthum/framework/kernel";
import ExecutionInspector from "./execution-inspector.svelte";
import ActorRequestCard from "./actor-request.svelte";
import ExecutionList from "./execution-list.svelte";
import RuleLauncher from "./rule-launcher.svelte";
import RuleSteps from "./automation-step-list.svelte";
const untouched = async () => {
  throw new Error("Rendering must not call the runtime");
};
const client: RuleExecutionClient = {
  listRuleExecutions: untouched,
  getRuleExecutionDetails: untouched,
  startRule: untouched,
  resumeRule: untouched,
  failRuleExecution: untouched,
  listActorRequests: untouched,
  respondToActorRequest: untouched,
};
const execution: RuleExecutionDetails = {
  id: "run-one",
  actorId: "jane",
  rule: { id: "approval", key: "approval", label: "Expense approval" },
  status: "waiting",
  createdAt: "2026-09-17T00:00:00.000Z",
  updatedAt: "2026-09-17T00:00:00.000Z",
  trace: [{ stepId: "prepare", kind: "compute", status: "completed" }],
  waiting: { kind: "request", stepId: "approve", requestId: "request-one" },
};
const request: ActorRequest = {
  id: "request-one",
  executionId: execution.id,
  actorId: "jane",
  label: "Review expense",
  status: "pending",
  createdAt: execution.createdAt,
  fields: [{ id: "answer", key: "approved", label: "Approve?", type: "boolean", required: true }],
};
describe("Execution Studio rendering", () => {
  it("renders user request authoring with shared fields and no runtime reads", () => {
    const body = render(RuleSteps, {
      props: {
        steps: [
          {
            id: "ask",
            wait: { request: { label: "Review expense", fields: request.fields }, as: "review" },
          },
        ],
        onStepsChange: () => {},
        inputName: "values",
        inputType: "",
        types: [],
        workflows: [],
        actorRequests: true,
        recordInput: false,
      },
    }).body;
    expect(body).toContain("Request title");
    expect(body).toContain("Response fields");
    expect(body).toContain("Approve?");
    expect(body).toContain("Assigned actor binding");
    expect(body).not.toContain("Optional signal key");
  });
  it("renders progress and an assigned task without reading or mutating the runtime", () => {
    const body = render(ExecutionInspector, {
      props: { execution, requests: [request], client, actorName: "Jane", onChange: untouched },
    }).body;
    expect(body).toContain("Expense approval");
    expect(body).toContain("Jane");
    expect(body).toContain("Review expense");
    expect(body).toContain("Submit response");
    expect(body).not.toContain("Send signal");
    expect(body).not.toContain("Terminate interrupted run");
  });
  it("shows terminal responses without submission controls", () => {
    const body = render(ActorRequestCard, {
      props: {
        request: { ...request, status: "responded", values: { approved: false } },
        onRespond: untouched,
      },
    }).body;
    expect(body).toContain("false");
    expect(body).not.toContain("Submit response");
  });
  it("separates signal input and deadline actions", () => {
    const signal = render(ExecutionInspector, {
      props: {
        execution: { ...execution, waiting: { kind: "signal", stepId: "wait", signal: "ready" } },
        client,
        onChange: untouched,
      },
    }).body;
    expect(signal).toContain("Send signal");
    expect(signal).toContain("ready");
    const delay = render(ExecutionInspector, {
      props: {
        execution: {
          ...execution,
          waiting: { kind: "delay", stepId: "wait", dueAt: execution.createdAt },
        },
        client,
        onChange: untouched,
      },
    }).body;
    expect(delay).toContain("Continue when due");
    expect(delay).not.toContain("textarea");
  });
  it("makes explicit termination opt-in and shows failure and final results", () => {
    const running = render(ExecutionInspector, {
      props: {
        execution: { ...execution, status: "running", waiting: undefined },
        client,
        onChange: untouched,
        canTerminate: true,
      },
    }).body;
    expect(running).toContain("Terminate interrupted run");
    const failed = render(ExecutionInspector, {
      props: {
        execution: { ...execution, status: "failed", waiting: undefined, failure: "Write failed" },
        client,
        onChange: untouched,
      },
    }).body;
    expect(failed).toContain("Write failed");
    const completed = render(ExecutionInspector, {
      props: {
        execution: {
          ...execution,
          status: "completed",
          waiting: undefined,
          vars: { outcome: "approved" },
        },
        client,
        onChange: untouched,
      },
    }).body;
    expect(completed).toContain("approved");
    expect(completed).not.toContain("Send signal");
  });
  it("renders paginated history and a typed launch form", () => {
    const body = render(ExecutionList, {
      props: { executions: [execution], onSelect: () => {}, onPage: () => {} },
    }).body;
    expect(body).toContain("Expense approval");
    expect(body).toContain("Previous");
    expect(body).toContain("Next");
    const launcher = render(RuleLauncher, {
      props: {
        rule: {
          ...execution.rule,
          steps: [],
          input: { amount: { value: "number", required: true } },
        },
        client,
        onStarted: () => {},
      },
    }).body;
    expect(launcher).toContain('type="number"');
    expect(launcher).toContain("Start run");
  });
});
