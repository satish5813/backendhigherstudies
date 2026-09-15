"""
Reads the LPA7 / LPA8 placement workbooks and writes one portable JSON payload
that `server/src/db/import-cohorts.js` loads into MySQL.

Two steps rather than one so the server never needs Python or an Excel parser:
the JSON is committed, and the VPS import is pure Node.

    pip install pandas openpyxl
    python scripts/extract-cohorts.py [--source "C:\\path\\to\\LPA&"] [--out server/src/db/data/cohorts.json]

Re-runnable. Rows are keyed on (cohort, registration number).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from datetime import date, datetime

try:
    import pandas as pd
except ImportError:                                    # pragma: no cover
    sys.exit("pandas is required:  pip install pandas openpyxl")

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
DEFAULT_SOURCE = os.path.dirname(PROJECT)              # the LPA& folder
DEFAULT_OUT = os.path.join(PROJECT, "server", "src", "db", "data", "cohorts.json")


# --------------------------------------------------------------------- helpers

def norm(col) -> str:
    """Column headers in these sheets vary by trailing spaces and newlines."""
    return re.sub(r"\s+", " ", str(col)).strip().lower()


def blank(v) -> bool:
    if v is None:
        return True
    if isinstance(v, float) and math.isnan(v):
        return True
    s = str(v).strip()
    return s == "" or s.lower() in {"nan", "none", "nat", "-", "na", "n/a"}


def text(v, limit=None):
    if blank(v):
        return None
    s = re.sub(r"\s+", " ", str(v)).strip().replace("\xa0", " ")
    return s[:limit] if limit else s


def num(v):
    if blank(v):
        return None
    s = str(v).strip().replace(",", "").replace("%", "")
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    if not m:
        return None
    try:
        return float(m.group())
    except ValueError:
        return None


def integer(v):
    f = num(v)
    return None if f is None else int(round(f))


def email(v):
    s = text(v)
    if not s or "@" not in s:
        return None
    s = s.strip().lower()
    # one record in the source has a 'gmail.con' typo
    s = re.sub(r"@gmail\.(con|co|cm)$", "@gmail.com", s)
    return s if re.match(r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$", s) else None


def iso_date(v):
    if blank(v):
        return None
    if isinstance(v, (datetime, date)):
        return v.strftime("%Y-%m-%d")
    s = str(v).strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y", "%d-%b-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s[:10], fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def reg_no(v):
    """Registration numbers arrive as ints, floats and strings across sheets."""
    if blank(v):
        return None
    s = str(v).strip()
    if s.endswith(".0"):
        s = s[:-2]
    s = re.sub(r"[^A-Za-z0-9]", "", s)
    return s or None


def get(row, *names):
    """First non-blank value among several possible column spellings."""
    for n in names:
        if n in row and not blank(row[n]):
            return row[n]
    return None


def sheets(path):
    if not os.path.exists(path):
        print(f"  ! missing: {os.path.basename(path)}")
        return None
    return pd.ExcelFile(path)


def rows_of(xl, sheet):
    df = xl.parse(sheet)
    df.columns = [norm(c) for c in df.columns]
    # drop the duplicate-suffixed columns pandas creates for repeated headers
    return df, [dict(r) for _, r in df.iterrows()]


# ------------------------------------------------------------------ extraction

def blank_record(cohort, rn, name):
    return {
        "cohort": cohort, "reg_no": rn, "name": name,
        "branch": None, "campus": None, "company": None, "ctc": None,
        "gender": None, "date_of_birth": None, "mobile": None,
        "placement_email": None, "personal_email": None,
        "ug_cgpa": None, "inter_cgpa": None, "ssc_cgpa": None,
        "rank_overall": None, "target_band": None, "near_next_band": None,
        "readiness_index": None, "dsa_score": None, "cp_score": None,
        "crt_score": None, "dev_score": None, "consistency_score": None,
        "academic_score": None, "crt_avg_pct": None, "crt_percentile": None,
        "crt_attendance": None,
        "strengths": None, "gaps": None, "plan_next_band": None, "data_notes": None,
        "assessments": {}, "coding": {},
    }


def merge(target, **fields):
    """Fill only the gaps — the first sheet that supplies a value wins."""
    for k, v in fields.items():
        if v is not None and target.get(k) is None:
            target[k] = v


def readiness_row(rec, row):
    merge(
        rec,
        branch=text(get(row, "branch", "branch.1"), 60),
        campus=text(get(row, "campus"), 20),
        company=text(get(row, "current company", "max company name", "company name"), 180),
        ctc=num(get(row, "current ctc", "max ctc", "ctc")),
        rank_overall=integer(get(row, "rank")),
        target_band=text(get(row, "target band"), 40),
        near_next_band=text(get(row, "near next band"), 40),
        readiness_index=num(get(row, "readiness index")),
        dsa_score=num(get(row, "dsa score")),
        cp_score=num(get(row, "cp score")),
        crt_score=num(get(row, "crt score")),
        dev_score=num(get(row, "dev score")),
        consistency_score=num(get(row, "consistency score")),
        academic_score=num(get(row, "academic score")),
        crt_avg_pct=num(get(row, "crt avg %")),
        crt_percentile=num(get(row, "crt percentile")),
        crt_attendance=num(get(row, "crt attendance %")),
        strengths=text(get(row, "strengths")),
        gaps=text(get(row, "gaps")),
        plan_next_band=text(get(row, "plan to next band")),
        data_notes=text(get(row, "data notes")),
        gender=text(get(row, "gender"), 20),
        date_of_birth=iso_date(get(row, "date of birth")),
        mobile=text(get(row, "mobile no"), 30),
        placement_email=email(get(row, "placement email id", "email id")),
        personal_email=email(get(row, "personal email id")),
        ug_cgpa=num(get(row, "ug cgpa")),
        inter_cgpa=num(get(row, "diploma cgpa/ intermediate cgpa",
                           "inter / diploma cgpa", "intermediate / diploma cgpa")),
        ssc_cgpa=num(get(row, "ssc cgpa")),
    )
    # sheet-level coding stats (present on the readiness tiers)
    lc_solved = integer(get(row, "lc solved"))
    if lc_solved is not None or get(row, "lc contest rating") is not None:
        cod = rec["coding"].setdefault("leetcode", {})
        cod.setdefault("solved", lc_solved)
        cod.setdefault("easy", integer(get(row, "lc easy")))
        cod.setdefault("medium", integer(get(row, "lc medium")))
        cod.setdefault("hard", integer(get(row, "lc hard")))
        cod.setdefault("rating", integer(get(row, "lc contest rating")))
        cod.setdefault("url", text(get(row, "leetcode url"), 400))
    if get(row, "cc max rating") is not None or get(row, "cc rating") is not None:
        cod = rec["coding"].setdefault("codechef", {})
        cod.setdefault("rating", integer(get(row, "cc rating")))
        cod.setdefault("max_rating", integer(get(row, "cc max rating")))
        cod.setdefault("stars", num(get(row, "cc stars")))
        cod.setdefault("solved", integer(get(row, "cc solved")))
        cod.setdefault("url", text(get(row, "codechef url"), 400))
    if get(row, "gh own repos") is not None or get(row, "gh stars") is not None:
        cod = rec["coding"].setdefault("github", {})
        cod.setdefault("repos", integer(get(row, "gh own repos", "gh total repos")))
        cod.setdefault("total_stars", integer(get(row, "gh stars")))
        cod.setdefault("url", text(get(row, "github url"), 400))


def profile_row(rec, row):
    """FINAL_student_coding_profiles / guessed_profiles / PREVIEW sheets."""
    merge(
        rec,
        branch=text(get(row, "branch"), 60),
        campus=text(get(row, "campus"), 20),
        company=text(get(row, "max company name"), 180),
        ctc=num(get(row, "max ctc")),
    )
    specs = [
        ("leetcode", "lc", dict(solved="lc solved", easy="lc easy", medium="lc medium",
                                hard="lc hard", rating="lc contest rating", stars="lc stars")),
        ("codechef", "cc", dict(solved="cc solved", rating="cc rating",
                                max_rating="cc max rating", stars="cc stars")),
        ("github", "gh", dict(repos="gh public repos", total_stars="gh total stars",
                              followers="gh followers")),
    ]
    for platform, prefix, numeric in specs:
        uname = text(get(row, f"{prefix} username"), 120)
        link = text(get(row, f"{prefix} link"), 400)
        if not uname and not link:
            continue
        cod = rec["coding"].setdefault(platform, {})
        if uname and not cod.get("username"):
            cod["username"] = uname
        if link and not cod.get("url"):
            cod["url"] = link
        conf = text(get(row, f"{prefix} confidence"))
        if conf and not cod.get("confidence"):
            cod["confidence"] = conf.upper()[:8]
        pname = text(get(row, f"{prefix} profile name"), 160)
        if pname and not cod.get("profile_name"):
            cod["profile_name"] = pname
        for field, column in numeric.items():
            val = num(get(row, column))
            if val is not None and cod.get(field) is None:
                cod[field] = val if field == "stars" else int(round(val))
        if platform == "github":
            top = text(get(row, "gh top repo"), 300)
            if top and not cod.get("top_repo"):
                cod["top_repo"] = top

    for i in range(1, 7):
        v = num(get(row, f"assessment-{i}"))
        if v is not None:
            rec["assessments"].setdefault(str(i), v)


def build(source):
    base, lpa8 = source, os.path.join(source, "lpa8")
    cohorts = {
        "lpa7": {
            "code": "lpa7",
            "name": "6-7 LPA cohort",
            "description": "Students placed in the 6-7 LPA band, with readiness banding and coding-profile evidence.",
            "source_file": "Readiness_Tiers_6_7_LPA.xlsx, LPA7.xlsx",
            "records": {},
        },
        "lpa8": {
            "code": "lpa8",
            "name": "8 LPA and above cohort",
            "description": "Students placed at 8 LPA or above, with CRT assessments, academics and coding-profile evidence.",
            "source_file": "KLU_Readiness_Tiers.xlsx, Readiness_Tiers.xlsx, FINAL_student_coding_profiles.xlsx, academic_records.xlsx",
            "records": {},
        },
    }

    def record(cohort, rn, name):
        recs = cohorts[cohort]["records"]
        if rn not in recs:
            recs[rn] = blank_record(cohort, rn, name)
        elif name and len(name) > len(recs[rn]["name"] or ""):
            recs[rn]["name"] = name
        return recs[rn]

    # ---------------------------------------------------------------- LPA7
    print("LPA7")
    xl = sheets(os.path.join(base, "Readiness_Tiers_6_7_LPA.xlsx"))
    if xl:
        _, rows = rows_of(xl, "All Students")
        for row in rows:
            rn = reg_no(get(row, "student id no"))
            if not rn:
                continue
            readiness_row(record("lpa7", rn, text(get(row, "student name"), 160)), row)
        print(f"  readiness tiers      {len(rows):>4} rows")

    xl = sheets(os.path.join(base, "LPA7.xlsx"))
    if xl:
        _, rows = rows_of(xl, "Sheet1")
        for row in rows:
            rn = reg_no(get(row, "fa", "student id no"))
            if not rn:
                continue
            rec = record("lpa7", rn, text(get(row, "student name"), 160))
            merge(rec,
                  branch=text(get(row, "branch"), 60),
                  campus=text(get(row, "campus"), 20),
                  company=text(get(row, "company name"), 180),
                  ctc=num(get(row, "ctc")))
        print(f"  placement list       {len(rows):>4} rows")

    # ---------------------------------------------------------------- LPA8
    print("LPA8")
    for filename in ("KLU_Readiness_Tiers.xlsx", "Readiness_Tiers.xlsx"):
        xl = sheets(os.path.join(lpa8, filename))
        if not xl:
            continue
        total = 0
        for sheet in xl.sheet_names:
            if sheet == "Band Criteria":
                continue
            _, rows = rows_of(xl, sheet)
            for row in rows:
                rn = reg_no(get(row, "student id no"))
                if not rn:
                    continue
                readiness_row(record("lpa8", rn, text(get(row, "student name"), 160)), row)
            total += len(rows)
        print(f"  {filename:<34} {total:>4} rows")

    for filename, sheet in (
        ("FINAL_student_coding_profiles.xlsx", "All Students"),
        ("guessed_profiles.xlsx", "Guessed Profiles"),
        ("PREVIEW_leetcode_github.xlsx", "Preview"),
        ("8 LPA Above Students-Assessment Scores.xlsx", "Sheet1"),
    ):
        xl = sheets(os.path.join(lpa8, filename))
        if not xl or sheet not in xl.sheet_names:
            continue
        _, rows = rows_of(xl, sheet)
        for row in rows:
            rn = reg_no(get(row, "student id no"))
            if not rn:
                continue
            profile_row(record("lpa8", rn, text(get(row, "student name"), 160)), row)
        print(f"  {filename:<34} {len(rows):>4} rows")

    xl = sheets(os.path.join(lpa8, "academic_records.xlsx"))
    if xl:
        _, rows = rows_of(xl, "Academic")
        for row in rows:
            rn = reg_no(get(row, "student id no"))
            if not rn:
                continue
            rec = record("lpa8", rn, text(get(row, "student name"), 160))
            merge(rec,
                  branch=text(get(row, "branch"), 60),
                  ug_cgpa=num(get(row, "ug cgpa")),
                  inter_cgpa=num(get(row, "intermediate / diploma cgpa")),
                  ssc_cgpa=num(get(row, "ssc cgpa")))
        print(f"  academic_records.xlsx              {len(rows):>4} rows")

    return cohorts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default=DEFAULT_SOURCE, help="folder holding the LPA workbooks")
    ap.add_argument("--out", default=DEFAULT_OUT)
    args = ap.parse_args()

    print(f"source: {args.source}\n")
    cohorts = build(args.source)

    payload = {"generatedAt": datetime.now().isoformat(timespec="seconds"), "cohorts": []}
    print("\nsummary")
    for c in cohorts.values():
        records = list(c["records"].values())
        for r in records:
            r["assessments"] = [{"no": int(k), "score": v} for k, v in sorted(r["assessments"].items())]
            r["coding"] = [{"platform": k, **v} for k, v in r["coding"].items()]
        payload["cohorts"].append({
            "code": c["code"], "name": c["name"],
            "description": c["description"], "source_file": c["source_file"],
            "records": records,
        })
        with_mail = sum(1 for r in records if r["placement_email"] or r["personal_email"])
        with_band = sum(1 for r in records if r["target_band"])
        with_code = sum(1 for r in records if r["coding"])
        print(f"  {c['code']:<6} {len(records):>4} students | {with_band:>3} banded | "
              f"{with_code:>3} with coding data | {with_mail:>3} with an email")

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1, ensure_ascii=False)
    size = os.path.getsize(args.out)
    print(f"\nwrote {args.out}  ({size:,} bytes)")
    print("now run:  node server/src/db/import-cohorts.js")


if __name__ == "__main__":
    main()
