import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { codingApi, profileApi } from '../lib/api';
import { useAuth } from '../store/auth';
import { useToast } from '../components/ui/Toast';
import { Badge, ConfirmDialog, EmptyState, Field, PageLoader, ScoreRing, Spinner } from '../components/ui';
import SectionForm from '../components/profile/SectionForm';
import PhotoUpload from '../components/profile/PhotoUpload';
import { PLATFORMS, SECTION_FORMS } from '../components/profile/forms';
import {
  IconAward, IconBriefcase, IconCheck, IconCode, IconEdit, IconGraduation,
  IconLayers, IconLink, IconPlus, IconRefresh, IconSparkles, IconTrash, IconUser,
} from '../components/ui/Icons';

const TABS = [
  { key: 'personal', label: 'Personal', icon: IconUser },
  { key: 'education', label: 'Education', icon: IconGraduation },
  { key: 'skills', label: 'Skills', icon: IconSparkles },
  { key: 'projects', label: 'Projects', icon: IconLayers },
  { key: 'experience', label: 'Experience', icon: IconBriefcase },
  { key: 'achievements', label: 'Achievements', icon: IconAward },
  { key: 'links', label: 'Links & coding', icon: IconLink },
];

export default function ProfileEditor() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'personal';
  const onboarding = params.get('onboarding') === '1';

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ open: false, section: null, initial: null });
  const [confirm, setConfirm] = useState(null);
  const toast = useToast();
  const { patchUser } = useAuth();

  const load = useCallback(async () => {
    try {
      setProfile(await profileApi.get());
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const setTab = (key) => {
    const next = new URLSearchParams(params);
    next.set('tab', key);
    setParams(next, { replace: true });
  };

  const saveItem = async (section, data) => {
    const existing = form.initial?.id;
    const saved = existing
      ? await profileApi.updateItem(section, existing, data)
      : await profileApi.addItem(section, data);
    await load();
    toast.success(existing ? 'Saved.' : `${SECTION_FORMS[section].singular} added.`);
    return saved;
  };

  const deleteItem = async () => {
    const { section, id } = confirm;
    try {
      await profileApi.deleteItem(section, id);
      await load();
      toast.success('Removed.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setConfirm(null);
    }
  };

  if (loading) return <PageLoader label="Loading your profile…" />;
  if (!profile) return <EmptyState icon={IconUser} title="Profile unavailable" message="Reload the page to try again." />;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="display-md">My profile</h1>
          <p className="mt-1 text-sm text-ink-500">
            Everything here flows into your resumes, your public page and your job matches.
          </p>
        </div>
        <div className="flex items-center gap-4 rounded-2xl border border-ink-200 bg-white px-4 py-3">
          <ScoreRing
            value={profile.completeness.percent}
            size={56}
            stroke={6}
            sublabel=""
            tone={profile.completeness.percent >= 80 ? 'emerald' : profile.completeness.percent >= 50 ? 'sky' : 'amber'}
          />
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-ink-400">Profile strength</p>
            <p className="text-sm font-semibold text-ink-800">
              {profile.completeness.missing.length
                ? `${profile.completeness.missing.length} item${profile.completeness.missing.length === 1 ? '' : 's'} left`
                : 'Complete'}
            </p>
          </div>
        </div>
      </header>

      {onboarding && (
        <div className="flex items-start gap-3 rounded-2xl border border-brand-200 bg-brand-50 px-5 py-4">
          <IconSparkles size={19} className="mt-0.5 shrink-0 text-brand-600" />
          <div>
            <p className="text-sm font-bold text-brand-900">Welcome to KL Placement Readiness</p>
            <p className="mt-0.5 text-sm leading-relaxed text-brand-800/80">
              Start with your personal details, then add education, skills and at least two projects.
              That is enough to generate a strong ATS resume.
            </p>
          </div>
        </div>
      )}

      {/* tabs */}
      <div className="scroll-thin -mx-1 overflow-x-auto px-1">
        <div className="flex min-w-max gap-1 rounded-xl border border-ink-200 bg-white p-1">
          {TABS.map(({ key, label, icon: Icon }) => {
            const count = key === 'links' || key === 'personal' ? null : (profile[key] || []).length;
            const active = tab === key;
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
                  active ? 'bg-brand-600 text-white shadow-sm' : 'text-ink-600 hover:bg-ink-100'
                }`}
              >
                <Icon size={16} className={active ? 'text-white' : 'text-ink-400'} />
                {label}
                {count != null && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? 'bg-white/20' : 'bg-ink-100 text-ink-500'}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {tab === 'personal' && <PersonalTab profile={profile} onSaved={(p) => { setProfile(p); patchUser({ name: p.user.name, slug: p.user.slug, avatarUrl: p.user.avatar_url }); }} />}
      {tab === 'links' && <LinksTab profile={profile} onSaved={setProfile} />}

      {['education', 'skills', 'projects', 'experience', 'achievements'].includes(tab) && (
        <SectionList
          section={tab}
          items={profile[tab]}
          onAdd={() => setForm({ open: true, section: tab, initial: null })}
          onEdit={(item) => setForm({ open: true, section: tab, initial: item })}
          onDelete={(item) => setConfirm({ section: tab, id: item.id, label: item.title || item.name || item.institution || item.company })}
        />
      )}

      <SectionForm
        section={form.section || 'skills'}
        open={form.open}
        initial={form.initial}
        onClose={() => setForm({ open: false, section: null, initial: null })}
        onSubmit={(data) => saveItem(form.section, data)}
      />

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={deleteItem}
        title="Remove this entry?"
        message={`“${confirm?.label || 'This entry'}” will be deleted from your profile and every resume that pulls from it. This cannot be undone.`}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ personal */

function PersonalTab({ profile, onSaved }) {
  const [values, setValues] = useState(() => ({ ...profile.user }));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const toast = useToast();

  const set = (k, v) => { setValues((s) => ({ ...s, [k]: v })); setErrors((e) => ({ ...e, [k]: undefined })); };

  const dirty = useMemo(
    () => JSON.stringify(pick(values)) !== JSON.stringify(pick(profile.user)),
    [values, profile.user]
  );

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const updated = await profileApi.update(pick(values));
      onSaved(updated);
      setValues({ ...updated.user });
      toast.success('Profile saved.');
    } catch (err) {
      const issue = err.issues?.[0];
      if (issue) setErrors({ [issue.field]: issue.message });
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="card p-5 sm:p-6" noValidate>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Full name" required error={errors.name} className="col-span-2 sm:col-span-1"
          hint="Appears at the top of every resume you generate.">
          <input className={`input ${errors.name ? 'input-error' : ''}`} value={values.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="Aarav Sharma" />
        </Field>

        <Field label="Email" className="col-span-2 sm:col-span-1" hint="Your login — cannot be changed here.">
          <input className="input" value={values.email} disabled />
        </Field>

        <Field label="Headline" className="col-span-2" error={errors.headline}
          hint="One line a recruiter reads first. Role + strongest signal.">
          <input className="input" value={values.headline ?? ''} onChange={(e) => set('headline', e.target.value)}
            placeholder="Final-year CSE student · Full Stack Developer · 450+ DSA problems solved" />
        </Field>

        <Field label="About / summary" className="col-span-2" error={errors.about}
          hint={`${(values.about || '').length} characters — aim for 300–600, naming your target role.`}>
          <textarea className="input" rows={5} value={values.about ?? ''} onChange={(e) => set('about', e.target.value)}
            placeholder="Final-year Computer Science student focused on backend engineering…" />
        </Field>

        <Field label="Phone" className="col-span-2 sm:col-span-1" error={errors.phone}>
          <input className={`input ${errors.phone ? 'input-error' : ''}`} value={values.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="+91 98765 43210" />
        </Field>

        <Field label="Location" className="col-span-2 sm:col-span-1" error={errors.location}>
          <input className="input" value={values.location ?? ''} onChange={(e) => set('location', e.target.value)} placeholder="Hyderabad, India" />
        </Field>

        <Field label="Campus" className="col-span-2 sm:col-span-1">
          <input className="input" value={values.campus ?? ''} onChange={(e) => set('campus', e.target.value)} placeholder="Vijayawada" />
        </Field>

        <Field label="Branch" className="col-span-2 sm:col-span-1">
          <input className="input" value={values.branch ?? ''} onChange={(e) => set('branch', e.target.value)} placeholder="Computer Science & Engineering" />
        </Field>

        <Field label="Registration number" className="col-span-2 sm:col-span-1">
          <input className="input" value={values.reg_no ?? ''} onChange={(e) => set('reg_no', e.target.value)} placeholder="21BCE1234" />
        </Field>

        <Field label="Graduation year" className="col-span-2 sm:col-span-1" error={errors.grad_year}>
          <input type="number" className="input" value={values.grad_year ?? ''} onChange={(e) => set('grad_year', e.target.value || null)} placeholder="2026" />
        </Field>

        <Field label="CGPA" className="col-span-2 sm:col-span-1" error={errors.cgpa} hint="Out of 10.">
          <input type="number" step="0.01" className="input" value={values.cgpa ?? ''} onChange={(e) => set('cgpa', e.target.value || null)} placeholder="8.74" />
        </Field>

        <div className="col-span-2">
          <PhotoUpload
            value={values.avatar_url}
            name={values.name}
            onChange={(url) => set('avatar_url', url)}
          />
        </div>

        <Field label="Public handle" className="col-span-2" error={errors.slug}
          hint={values.slug ? `Your profile lives at ${window.location.origin}/u/${values.slug}` : 'Set a handle to publish your profile.'}>
          <div className="flex items-center gap-0 overflow-hidden rounded-xl border border-ink-200 focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/10">
            <span className="shrink-0 bg-ink-50 px-3 py-2.5 font-mono text-xs text-ink-500">/u/</span>
            <input
              className="w-full border-0 px-3 py-2.5 text-sm outline-none"
              value={values.slug ?? ''}
              onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              placeholder="aarav-sharma"
            />
          </div>
        </Field>

        <div className="col-span-2 grid gap-3 sm:grid-cols-2">
          <Toggle
            checked={Boolean(values.open_to_work)}
            onChange={(v) => set('open_to_work', v)}
            title="Open to work"
            body="Shows an “open to work” badge on your public profile."
          />
          <Toggle
            checked={Boolean(values.profile_public)}
            onChange={(v) => set('profile_public', v)}
            title="Public profile"
            body="Anyone with your link can view your profile page."
          />
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between border-t border-ink-100 pt-5">
        <p className="text-xs text-ink-400">{dirty ? 'You have unsaved changes.' : 'All changes saved.'}</p>
        <button type="submit" className="btn-primary" disabled={saving || !dirty}>
          {saving ? <Spinner size={15} /> : <IconCheck size={16} />}
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

const PERSONAL_KEYS = ['name', 'headline', 'about', 'phone', 'location', 'campus', 'branch', 'reg_no', 'grad_year', 'cgpa', 'avatar_url', 'slug', 'open_to_work', 'profile_public'];
const pick = (o) => Object.fromEntries(PERSONAL_KEYS.map((k) => [k, o?.[k] ?? null]));

function Toggle({ checked, onChange, title, body }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex items-start gap-3 rounded-xl border p-3.5 text-left transition ${
        checked ? 'border-brand-300 bg-brand-50/50' : 'border-ink-200 hover:bg-ink-50'
      }`}
    >
      <span className={`relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition ${checked ? 'bg-brand-600' : 'bg-ink-300'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[1.125rem]' : 'left-0.5'}`} />
      </span>
      <span>
        <span className="block text-sm font-bold text-ink-900">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-ink-500">{body}</span>
      </span>
    </button>
  );
}

/* --------------------------------------------------------------- section list */

function SectionList({ section, items, onAdd, onEdit, onDelete }) {
  const spec = SECTION_FORMS[section];

  return (
    <section className="card p-5 sm:p-6">
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-ink-900">{spec.title}</h2>
          <p className="mt-0.5 text-sm text-ink-500">{spec.blurb}</p>
        </div>
        <button onClick={onAdd} className="btn-primary h-10 shrink-0">
          <IconPlus size={16} /> Add {spec.singular}
        </button>
      </header>

      {!items.length ? (
        <EmptyState
          icon={IconPlus}
          title={`No ${spec.title.toLowerCase()} yet`}
          message={spec.empty}
          action={<button onClick={onAdd} className="btn-primary h-9 text-xs">Add your first {spec.singular}</button>}
        />
      ) : section === 'skills' ? (
        <SkillGrid items={items} onEdit={onEdit} onDelete={onDelete} />
      ) : (
        <ul className="divide-y divide-ink-100">
          {items.map((item) => (
            <li key={item.id} className="group flex gap-4 py-4 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <ItemSummary section={section} item={item} />
              </div>
              <div className="flex shrink-0 gap-1 opacity-60 transition group-hover:opacity-100">
                <button onClick={() => onEdit(item)} className="rounded-lg p-2 text-ink-400 transition hover:bg-ink-100 hover:text-ink-900" aria-label="Edit">
                  <IconEdit size={16} />
                </button>
                <button onClick={() => onDelete(item)} className="rounded-lg p-2 text-ink-400 transition hover:bg-rose-50 hover:text-rose-600" aria-label="Delete">
                  <IconTrash size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ItemSummary({ section, item }) {
  if (section === 'education') {
    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-bold text-ink-900">{item.institution}</p>
          <Badge tone="slate">{item.level.toUpperCase()}</Badge>
        </div>
        <p className="mt-0.5 text-sm text-ink-600">
          {[item.degree, item.branch].filter(Boolean).join(' · ') || '—'}
        </p>
        <p className="mt-1 text-xs text-ink-400">
          {[item.start_year, item.end_year].filter(Boolean).join(' – ')}
          {item.score != null && ` · ${item.score}${item.score_type === 'cgpa' ? ' CGPA' : '%'}`}
          {item.location && ` · ${item.location}`}
        </p>
      </>
    );
  }

  if (section === 'projects') {
    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-bold text-ink-900">{item.title}</p>
          {item.featured && <Badge tone="brand">Featured</Badge>}
        </div>
        {item.description && <p className="mt-1 text-sm leading-relaxed text-ink-600">{item.description}</p>}
        {item.tech?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.tech.map((t) => <Badge key={t} tone="slate">{t}</Badge>)}
          </div>
        )}
        {item.highlights?.length > 0 && (
          <ul className="mt-2 space-y-1 pl-4 text-[13px] leading-snug text-ink-600">
            {item.highlights.map((h, i) => <li key={i} className="list-disc">{h}</li>)}
          </ul>
        )}
      </>
    );
  }

  if (section === 'experience') {
    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-bold text-ink-900">{item.role}</p>
          <Badge tone="slate">{item.type}</Badge>
          {item.is_current && <Badge tone="emerald">Current</Badge>}
        </div>
        <p className="mt-0.5 text-sm text-ink-600">{item.company}{item.location ? ` · ${item.location}` : ''}</p>
        <p className="mt-1 text-xs text-ink-400">
          {[fmtMonth(item.start_date), item.is_current ? 'Present' : fmtMonth(item.end_date)].filter(Boolean).join(' – ')}
        </p>
        {item.highlights?.length > 0 && (
          <ul className="mt-2 space-y-1 pl-4 text-[13px] leading-snug text-ink-600">
            {item.highlights.map((h, i) => <li key={i} className="list-disc">{h}</li>)}
          </ul>
        )}
      </>
    );
  }

  // achievements
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-bold text-ink-900">{item.title}</p>
        <Badge tone="slate">{item.category}</Badge>
      </div>
      <p className="mt-0.5 text-sm text-ink-600">
        {[item.issuer, fmtMonth(item.date)].filter(Boolean).join(' · ')}
      </p>
      {item.description && <p className="mt-1 text-[13px] leading-relaxed text-ink-500">{item.description}</p>}
    </>
  );
}

function SkillGrid({ items, onEdit, onDelete }) {
  const grouped = items.reduce((acc, s) => {
    (acc[s.category] ||= []).push(s);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      {Object.entries(grouped).map(([category, list]) => (
        <div key={category}>
          <p className="section-title mb-2.5">{category}</p>
          <div className="flex flex-wrap gap-2">
            {list.map((s) => (
              <div key={s.id} className="group flex items-center gap-2 rounded-xl border border-ink-200 bg-white py-1.5 pl-3 pr-1.5 transition hover:border-brand-300">
                <span className="text-sm font-semibold text-ink-800">{s.name}</span>
                <span className="flex gap-0.5" title={`Proficiency ${s.proficiency}/5`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <span key={n} className={`h-1.5 w-1.5 rounded-full ${n <= s.proficiency ? 'bg-brand-500' : 'bg-ink-200'}`} />
                  ))}
                </span>
                <button onClick={() => onEdit(s)} className="rounded-md p-1 text-ink-300 opacity-0 transition group-hover:opacity-100 hover:bg-ink-100 hover:text-ink-700" aria-label="Edit">
                  <IconEdit size={13} />
                </button>
                <button onClick={() => onDelete(s)} className="rounded-md p-1 text-ink-300 opacity-0 transition group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete">
                  <IconTrash size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------- links */

function LinksTab({ profile, onSaved }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(PLATFORMS.map((p) => [p.key, profile.links.find((l) => l.platform === p.key)?.username ?? '']))
  );
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [coding, setCoding] = useState(profile.coding || []);
  const toast = useToast();

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await profileApi.setLinks(PLATFORMS.map((p) => ({ platform: p.key, username: values[p.key] || null })));
      onSaved(updated);
      setCoding(updated.coding || []);
      toast.success('Links saved. Sync to pull your stats.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await codingApi.sync(null, true);
      setCoding(res.items);
      const failed = (res.results || []).filter((r) => r.status === 'not_found');
      if (failed.length) toast.error(`Handle not found on: ${failed.map((f) => f.platform).join(', ')}. Check the spelling.`);
      else toast.success(res.synced ? `Synced ${res.synced} platform${res.synced === 1 ? '' : 's'}.` : res.message);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={save} className="card p-5 sm:p-6">
        <header className="mb-5">
          <h2 className="text-lg font-bold tracking-tight text-ink-900">Profile links</h2>
          <p className="mt-0.5 text-sm text-ink-500">
            Paste a username or the full profile URL — we normalise either. Leave a field empty to unlink it.
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          {PLATFORMS.map((p) => (
            <Field key={p.key} label={p.label} hint={p.help}>
              <input
                className="input"
                value={values[p.key]}
                onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))}
                placeholder={p.placeholder}
              />
            </Field>
          ))}
        </div>

        <div className="mt-6 flex justify-end gap-2 border-t border-ink-100 pt-5">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? <Spinner size={15} /> : <IconCheck size={16} />} Save links
          </button>
        </div>
      </form>

      <section className="card p-5 sm:p-6">
        <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-ink-900">Coding stats</h2>
            <p className="mt-0.5 text-sm text-ink-500">Pulled live from each platform and cached for 10 minutes.</p>
          </div>
          <button onClick={sync} disabled={syncing} className="btn-secondary h-10 shrink-0">
            {syncing ? <Spinner size={15} /> : <IconRefresh size={16} />} {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        </header>

        {!coding.length ? (
          <EmptyState
            icon={IconCode}
            title="Nothing linked yet"
            message="Add a LeetCode, GitHub or CodeChef handle above, save, then sync."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {coding.map((c) => <CodingCard key={c.platform} profile={c} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function CodingCard({ profile: c }) {
  if (c.status !== 'ok') {
    const message = {
      not_found: 'That username does not exist on this platform. Check the spelling and sync again.',
      unlinked: 'Saved — hit “Sync now” to pull the stats.',
      error: 'The platform did not respond. Try syncing again in a minute.',
    }[c.status];
    return (
      <div className="rounded-xl border border-dashed border-ink-200 bg-ink-50/50 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold capitalize text-ink-700">{c.platform}</p>
          <Badge tone={c.status === 'not_found' ? 'rose' : 'slate'}>
            {c.status === 'not_found' ? 'Not found' : c.status === 'unlinked' ? 'Not synced' : 'Error'}
          </Badge>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-ink-500">{message}</p>
      </div>
    );
  }

  const rows = c.platform === 'github'
    ? [['Public repos', c.solved_total], ['Followers', c.reputation]]
    : [
        ['Solved', c.solved_total],
        ['Easy / Med / Hard', [c.easy, c.medium, c.hard].filter((x) => x != null).join(' / ') || null],
        ['Contest rating', c.contest_rating],
        ['Global rank', c.global_rank?.toLocaleString?.() ?? c.global_rank],
        ['Stars', c.star_rating],
      ];

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold capitalize text-ink-900">{c.platform}</p>
        <Badge tone="emerald">Synced</Badge>
      </div>
      <a href={c.profileUrl} target="_blank" rel="noreferrer" className="mt-0.5 block truncate font-mono text-xs text-brand-600 hover:underline">
        {c.username}
      </a>
      <dl className="mt-3 space-y-1.5">
        {rows.filter(([, v]) => v != null && v !== '').map(([label, value]) => (
          <div key={label} className="flex justify-between text-xs">
            <dt className="text-ink-500">{label}</dt>
            <dd className="font-mono font-semibold text-ink-900">{value}</dd>
          </div>
        ))}
      </dl>
      {c.badges && <p className="mt-2.5 truncate text-[11px] text-ink-400">{c.badges}</p>}
    </div>
  );
}

function fmtMonth(d) {
  if (!d) return '';
  const date = new Date(String(d).length === 7 ? `${d}-01` : d);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
