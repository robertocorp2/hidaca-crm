import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PipelineStepper,
  pipelineStageState,
  type PipelineOutcome,
} from "../app/app/pipeline";

test("pipeline stage states distinguish completed, current, and upcoming", () => {
  const completed = new Set(["evaluation"]);

  assert.equal(
    pipelineStageState("evaluation", "quote", completed),
    "completed",
  );
  assert.equal(pipelineStageState("quote", "quote", completed), "current");
  assert.equal(
    pipelineStageState("negotiation_review", "quote", completed),
    "upcoming",
  );
});

test("terminal outcomes render as mutually exclusive selected results", () => {
  const outcomes: PipelineOutcome[] = [
    {
      value: "won",
      label: "Ganada",
      description: "Resultado de cierre seleccionado.",
      tone: "success",
    },
    {
      value: "lost",
      label: "Perdida",
      description: "Resultado de cierre seleccionado.",
      tone: "loss",
    },
  ];
  const html = renderToStaticMarkup(
    createElement(PipelineStepper, {
      ariaLabel: "Pipeline de prueba",
      busy: false,
      completedStages: new Set(["evaluation", "quote", "negotiation_review"]),
      currentStatus: "closed",
      selectedOutcome: "won",
      stages: [
        { value: "evaluation", label: "Evaluación" },
        { value: "quote", label: "Cotización" },
        {
          value: "negotiation_review",
          label: "Negociación / revisión internacional",
        },
        { value: "closed", label: "Cerrada" },
      ],
      terminalOutcomes: outcomes,
    }),
  );

  assert.match(html, /aria-current="step"/);
  assert.match(html, /Cerrada — Ganada/);
  assert.match(html, /pipeline-outcome-success/);
  assert.match(html, /Negociación \/ revisión internacional/);
  assert.match(html, />Ganada</);
  assert.doesNotMatch(html, />Perdida</);
});

test("pipeline actions expose loading and duplicate-submit protection", () => {
  const html = renderToStaticMarkup(
    createElement(PipelineStepper, {
      action: { label: "Avanzar a Cotización", onAction: () => undefined },
      busy: true,
      completedStages: new Set(["evaluation"]),
      currentStatus: "quote",
      stages: [
        { value: "evaluation", label: "Evaluación" },
        { value: "quote", label: "Cotización" },
      ],
    }),
  );

  assert.match(html, /<button[^>]*disabled=""/);
  assert.match(html, />Guardando…</);
});
