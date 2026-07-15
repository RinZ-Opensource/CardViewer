import { applyEdits, randomDigitString } from "./cardData";
import { PLAYER_EDIT_KEYS } from "./cardEdits";
import { CardEdits, CardRecord, PrintField, PrintFieldValue } from "./types";

function isPlayerField(field: PrintField) {
  return PLAYER_EDIT_KEYS.has(field.key);
}

export function EditorPanel({
  card,
  edits,
  onChange,
  onPlayerChange,
  onReset,
  onResetPlayer,
  canReset,
  canResetPlayer,
}: {
  card: CardRecord | null;
  edits: CardEdits | undefined;
  onChange: (fieldKey: string, value: PrintFieldValue) => void;
  onPlayerChange: (fieldKey: string, value: PrintFieldValue) => void;
  onReset: () => void;
  onResetPlayer: () => void;
  canReset: boolean;
  canResetPlayer: boolean;
}) {
  if (!card) {
    return <aside className="editor-panel empty">No selection</aside>;
  }

  const merged = applyEdits(card, edits);
  const visibleFields = merged.printFields.filter((field) => field.fieldType !== "metadata");
  const playerFields = visibleFields.filter(isPlayerField);
  const valueFields = merged.printFields.filter(
    (field) => !isPlayerField(field) && field.fieldType !== "bool" && field.fieldType !== "metadata",
  );
  const flagFields = merged.printFields.filter((field) => !isPlayerField(field) && field.fieldType === "bool");

  // Keep the holo toggle at the top of the flags section.
  const holoFlagIndex = flagFields.findIndex((field) => field.key === "holo");
  if (holoFlagIndex > 0) {
    flagFields.unshift(flagFields.splice(holoFlagIndex, 1)[0]);
  }

  const isPlayerDataApplicable = merged.game.toUpperCase() !== "CHU" && playerFields.length > 0;
  const editJson = JSON.stringify(edits ?? {}, null, 2);

  return (
    <aside className="editor-panel">
      <div className="editor-scroll">
        <section className="editor-section">
          <div className="editor-header">
            <h3>Player Data</h3>
            <button
              type="button"
              className="ghost-button"
              onClick={onResetPlayer}
              disabled={!canResetPlayer}
            >
              Reset shared
            </button>
          </div>

          {isPlayerDataApplicable ? (
            <div className="form-grid player-data-grid">
              {playerFields.map((field) => (
                <PrintFieldControl key={field.key} field={field} onChange={onPlayerChange} />
              ))}
            </div>
          ) : (
            <p className="section-empty">Not applicable</p>
          )}
        </section>

        <section className="editor-section">
          <div className="editor-header">
            <h3>Print Surface</h3>
            <button type="button" className="ghost-button" onClick={onReset} disabled={!canReset}>
              Reset
            </button>
          </div>

          <div className="form-grid">
            {valueFields.map((field) => (
              <PrintFieldControl key={field.key} field={field} onChange={onChange} />
            ))}
            {flagFields.length ? (
              <div className="flag-section">
                <h4>Visibility / print flags</h4>
                {flagFields.map((field) => (
                  <PrintFieldControl key={field.key} field={field} onChange={onChange} />
                ))}
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <details className="edit-json">
        <summary>Override JSON</summary>
        <pre>{editJson}</pre>
      </details>
    </aside>
  );
}

export function PrintFieldControl({
  field,
  onChange,
}: {
  field: PrintField;
  onChange: (fieldKey: string, value: PrintFieldValue) => void;
}) {
  if (field.fieldType === "bool") {
    return (
      <label className="control toggle-control">
        <input
          type="checkbox"
          checked={field.value === "true"}
          onChange={(event) => onChange(field.key, event.target.checked)}
        />
        <span>{field.label}</span>
      </label>
    );
  }

  if (field.fieldType === "multiline") {
    return (
      <label className="control wide">
        <span>{field.label}</span>
        <textarea
          value={field.value ?? ""}
          onChange={(event) => onChange(field.key, event.target.value)}
          rows={5}
        />
      </label>
    );
  }

  if (field.fieldType === "select") {
    return (
      <label className="control">
        <span>{field.label}</span>
        <select
          value={field.value ?? ""}
          onChange={(event) => onChange(field.key, event.target.value)}
        >
          {(field.options ?? []).map((option) => (
            <option value={option.value} key={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  const serialInputId = "print-field-serial-id";
  const input = (
    <input
      id={field.key === "serialId" ? serialInputId : undefined}
      type={field.fieldType === "number" ? "number" : "text"}
      value={field.value ?? ""}
      onChange={(event) => onChange(field.key, event.target.value)}
    />
  );

  if (field.key === "serialId") {
    return (
      <div className="control">
        <label className="control-label" htmlFor={serialInputId}>
          {field.label}
        </label>
        <span className="input-with-action">
          {input}
          <button
            type="button"
            className="input-action-button"
            aria-label="Generate 20 digit random serial"
            title="Generate 20 digit random serial"
            onClick={() => onChange(field.key, randomDigitString(20))}
          >
            ↻
          </button>
        </span>
      </div>
    );
  }

  return (
    <label className="control">
      <span>{field.label}</span>
      {input}
    </label>
  );
}
