import { useEffect, useState } from 'react';
import { Field, Modal, Spinner, TagInput } from '../ui';
import { IconPlus, IconTrash } from '../ui/Icons';
import { AiBulletButton } from '../resume/AiAssist';
import { SECTION_FORMS } from './forms';

/** Renders the modal form for one section item from its field definitions. */
export default function SectionForm({ section, open, initial, onClose, onSubmit }) {
  const spec = SECTION_FORMS[section];
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValues({ ...spec.defaults, ...stripServerFields(initial) });
    setErrors({});
  }, [open, initial, spec.defaults]);

  const set = (name, value) => {
    setValues((v) => ({ ...v, [name]: value }));
    setErrors((e) => ({ ...e, [name]: undefined }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const nextErrors = {};
    for (const f of spec.fields) {
      if (f.required && !String(values[f.name] ?? '').trim()) nextErrors[f.name] = `${f.label} is required.`;
    }
    if (Object.keys(nextErrors).length) return setErrors(nextErrors);

    setBusy(true);
    try {
      await onSubmit(clean(values));
      onClose();
    } catch (err) {
      const issue = err.issues?.[0];
      if (issue) setErrors({ [issue.field]: issue.message });
      else setErrors({ _: err.message });
    } finally {
      setBusy(false);
    }
  };

  if (!spec) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={initial?.id ? `Edit ${spec.singular}` : `Add ${spec.singular}`}
      subtitle={spec.blurb}
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-rose-600">{errors._ || ''}</p>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" form="section-form" className="btn-primary" disabled={busy}>
              {busy && <Spinner size={15} />}
              {initial?.id ? 'Save changes' : `Add ${spec.singular}`}
            </button>
          </div>
        </div>
      }
    >
      <form id="section-form" onSubmit={submit} className="grid grid-cols-2 gap-4" noValidate>
        {spec.fields.map((f) => {
          if (f.hideIf && values[f.hideIf]) return null;
          return (
            <Field
              key={f.name}
              label={f.type === 'switch' ? null : f.label}
              hint={f.hint}
              error={errors[f.name]}
              required={f.required}
              className={f.width === 'half' ? 'col-span-2 sm:col-span-1' : 'col-span-2'}
            >
              <Control
                field={f}
                value={values[f.name]}
                onChange={(v) => set(f.name, v)}
                invalid={Boolean(errors[f.name])}
                context={{ role: values.role, company: values.company || values.title, tech: values.tech || [] }}
              />
            </Field>
          );
        })}
      </form>
    </Modal>
  );
}

function Control({ field: f, value, onChange, invalid, context }) {
  const cls = `input ${invalid ? 'input-error' : ''}`;

  switch (f.type) {
    case 'textarea':
      return (
        <textarea
          className={cls}
          rows={f.rows || 3}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={f.placeholder}
        />
      );

    case 'select':
      return (
        <select className={cls} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          {f.options.map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
      );

    case 'number':
      return (
        <input
          type="number"
          step={f.step}
          className={cls}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          placeholder={f.placeholder}
        />
      );

    case 'month':
      return (
        <input
          type="month"
          className={cls}
          value={(value ?? '').slice(0, 7)}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );

    case 'url':
      return (
        <input type="url" className={cls} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} />
      );

    case 'switch':
      return (
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-ink-200 px-3.5 py-2.5 transition hover:bg-ink-50">
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(value)}
            onClick={() => onChange(!value)}
            className={`relative h-6 w-10 shrink-0 rounded-full transition ${value ? 'bg-brand-600' : 'bg-ink-300'}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${value ? 'left-[1.125rem]' : 'left-0.5'}`} />
          </button>
          <span className="text-sm font-semibold text-ink-700">{f.label}</span>
        </label>
      );

    case 'tags':
      return <TagInput value={value || []} onChange={onChange} placeholder={f.placeholder} />;

    case 'bullets':
      return <BulletEditor value={value || []} onChange={onChange} context={context} />;

    default:
      return (
        <input type="text" className={cls} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} />
      );
  }
}

/** Repeatable one-line achievement bullets — the lines the ATS scorer reads. */
function BulletEditor({ value, onChange, context = {} }) {
  const update = (i, text) => onChange(value.map((v, idx) => (idx === i ? text : v)));
  const remove = (i) => onChange(value.filter((_, idx) => idx !== i));
  const add = () => onChange([...value, '']);

  return (
    <div className="space-y-2">
      {value.map((bullet, i) => {
        const words = bullet.trim().split(/\s+/).filter(Boolean).length;
        const hasNumber = /\d/.test(bullet);
        return (
          <div key={i} className="group flex gap-2">
            <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-300" />
            <div className="flex-1">
              <textarea
                rows={2}
                className="input resize-y text-[13px]"
                value={bullet}
                onChange={(e) => update(i, e.target.value)}
                placeholder="Cut payment-webhook p95 latency 68% (840ms → 270ms) by batching database writes."
              />
              {bullet.trim() && (
                <AiBulletButton
                  text={bullet}
                  role={context.role}
                  company={context.company}
                  tech={context.tech}
                  onApply={(next) => update(i, next)}
                  compact
                />
              )}
              {bullet.trim() && (
                <div className="mt-1 flex gap-3 text-[11px]">
                  <span className={hasNumber ? 'text-emerald-600' : 'text-amber-600'}>
                    {hasNumber ? '✓ quantified' : '! add a number'}
                  </span>
                  <span className={words > 32 ? 'text-amber-600' : 'text-ink-400'}>{words} words</span>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => remove(i)}
              className="mt-1 h-8 shrink-0 rounded-lg px-2 text-ink-300 transition hover:bg-rose-50 hover:text-rose-600"
              aria-label="Remove bullet"
            >
              <IconTrash size={15} />
            </button>
          </div>
        );
      })}
      <button type="button" onClick={add} className="btn-secondary h-9 w-full text-xs">
        <IconPlus size={14} /> Add bullet point
      </button>
    </div>
  );
}

/** Strips the fields the API owns so an edit never tries to write them back. */
function stripServerFields(item) {
  if (!item) return {};
  const { id, user_id, sort_order, ...rest } = item;
  return rest;
}

/** Empty strings become null so the server's `.nullish()` fields accept them. */
function clean(values) {
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === 'string') out[k] = v.trim() === '' ? null : v.trim();
    else if (Array.isArray(v)) out[k] = v.map((x) => (typeof x === 'string' ? x.trim() : x)).filter((x) => x !== '');
    else out[k] = v;
  }
  return out;
}
