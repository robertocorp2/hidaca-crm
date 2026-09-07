"use client";

import type { CSSProperties } from "react";

export type PipelineStageState = "completed" | "current" | "upcoming";
export type PipelineOutcomeTone = "success" | "loss" | "neutral";

export type PipelineStage = {
  value: string;
  label: string;
  description?: string;
};

export type PipelineOutcome = {
  value: string;
  label: string;
  description: string;
  tone: PipelineOutcomeTone;
  actionLabel?: string;
  actionDisabled?: boolean;
  onSelect?(): void;
};

export function pipelineStageState(
  stage: string,
  currentStatus: string,
  completedStages: ReadonlySet<string>,
): PipelineStageState {
  if (stage === currentStatus) return "current";
  if (completedStages.has(stage)) return "completed";
  return "upcoming";
}

const stateLabels: Record<PipelineStageState, string> = {
  completed: "completada",
  current: "actual",
  upcoming: "próxima",
};

export function PipelineStepper({
  stages,
  currentStatus,
  completedStages,
  terminalOutcomes = [],
  selectedOutcome,
  outcomeHeading = "Resultado final",
  outcomeDescription,
  busy,
  action,
  ariaLabel = "Pipeline",
}: {
  stages: ReadonlyArray<PipelineStage>;
  currentStatus: string;
  completedStages: ReadonlySet<string>;
  terminalOutcomes?: ReadonlyArray<PipelineOutcome>;
  selectedOutcome?: string | null;
  outcomeHeading?: string;
  outcomeDescription?: string;
  busy: boolean;
  action?: {
    label: string;
    disabled?: boolean;
    onAction(): void;
  };
  ariaLabel?: string;
}) {
  const visibleOutcomes = selectedOutcome
    ? terminalOutcomes.filter((outcome) => outcome.value === selectedOutcome)
    : terminalOutcomes;
  const selectedOutcomeLabel = terminalOutcomes.find(
    (outcome) => outcome.value === selectedOutcome,
  )?.label;

  return (
    <section aria-label={ariaLabel} className="pipeline-card">
      <div
        className={`pipeline-layout${visibleOutcomes.length ? " pipeline-has-outcomes" : ""}`}
      >
        <div
          aria-label="Etapas del pipeline; desplaza horizontalmente si es necesario"
          className="pipeline-scroll"
          role="region"
          tabIndex={0}
        >
          <ol
            className="pipeline-stepper"
            style={{
              "--pipeline-column-count": stages.length,
            } as CSSProperties}
          >
            {stages.map((stage, index) => {
              const state = pipelineStageState(
                stage.value,
                currentStatus,
                completedStages,
              );
              const accessibleState =
                state === "current" && selectedOutcomeLabel
                  ? `${stage.label} — ${selectedOutcomeLabel}`
                  : `${stage.label} — ${stateLabels[state]}`;
              return (
                <li
                  aria-current={state === "current" ? "step" : undefined}
                  className={`pipeline-step pipeline-${state}`}
                  key={stage.value}
                >
                  <div aria-hidden="true" className="pipeline-indicator-row">
                    {(index < stages.length - 1 ||
                      visibleOutcomes.length > 0) && (
                      <span
                        className={`pipeline-connector${index === stages.length - 1 ? " pipeline-connector-terminal" : ""}`}
                      />
                    )}
                    <span className="pipeline-dot">
                      {state === "completed" ? "✓" : index + 1}
                    </span>
                  </div>
                  <div className="pipeline-label-row">
                    <span aria-hidden="true" className="pipeline-label">
                      {stage.label}
                    </span>
                    {stage.description && (
                      <span
                        aria-hidden="true"
                        className="pipeline-description"
                      >
                        {stage.description}
                      </span>
                    )}
                    <span className="visually-hidden">{accessibleState}</span>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        {visibleOutcomes.length > 0 && (
          <div className="pipeline-outcome-branch">
            <div className="pipeline-outcome-heading">
              <strong>{outcomeHeading}</strong>
              {outcomeDescription && <span>{outcomeDescription}</span>}
            </div>
            <ul aria-label={outcomeHeading} className="pipeline-outcomes">
              {visibleOutcomes.map((outcome) => {
                const isSelected = outcome.value === selectedOutcome;
                const statusText = isSelected
                  ? "resultado seleccionado"
                  : outcome.onSelect
                    ? "resultado disponible"
                    : "resultado alternativo";
                return (
                  <li
                    className={`pipeline-outcome pipeline-outcome-${isSelected ? outcome.tone : "neutral"}${isSelected ? " pipeline-outcome-selected" : ""}`}
                    key={outcome.value}
                  >
                    <span aria-hidden="true" className="pipeline-outcome-icon">
                      {isSelected
                        ? outcome.tone === "loss"
                          ? "×"
                          : "✓"
                        : "↗"}
                    </span>
                    <span
                      aria-hidden="true"
                      className="pipeline-outcome-copy"
                    >
                      <strong>{outcome.label}</strong>
                      <span>{outcome.description}</span>
                    </span>
                    <span className="visually-hidden">
                      {outcome.label} — {statusText}. {outcome.description}
                    </span>
                    {outcome.onSelect && outcome.actionLabel && (
                      <button
                        className={
                          outcome.tone === "loss"
                            ? "secondary-button"
                            : "primary-button"
                        }
                        disabled={busy || outcome.actionDisabled}
                        onClick={outcome.onSelect}
                        type="button"
                      >
                        {busy ? "Guardando…" : outcome.actionLabel}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {action && (
        <div className="pipeline-controls">
          <button
            className="primary-button pipeline-action"
            disabled={busy || action.disabled}
            onClick={action.onAction}
            type="button"
          >
            {busy ? "Guardando…" : action.label}
          </button>
        </div>
      )}
    </section>
  );
}
