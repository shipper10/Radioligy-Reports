#!/usr/bin/env python3
"""
تحويل ملفات Word (التقارير وبنوك التعابير) إلى بيانات JSON يقرؤها الموقع.

الاستخدام (من جذر المستودع):
    pip install python-docx
    python tools/build_data.py

القاعدة: كل مجلد في جذر المستودع اسمه "<NAME> REPORTS" هو قسم (modality)،
وكل مجلد داخله هو دراسة (study) تحوي ملفات docx:
    *Template*   قالب بقيم طبيعية افتراضية وحقول بين [ ]
    *Blank*      هيكل فارغ
    *Normal*     مثال طبيعي كامل
    *Limited*    (اختياري) حالة محدودة
    *Phrases*    بنك التعابير
ويمكن إضافة Standard / Prominent_Lead في الاسم لتمييز التنسيقات.
تفاصيل أكثر في docs/ADDING-REPORTS.md
"""
import json
import re
import sys
import datetime
from pathlib import Path

try:
    import docx
except ImportError:  # pragma: no cover
    sys.exit("ثبّت المكتبة أولاً:  pip install python-docx")

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
KIND_ORDER = {"template": 0, "blank": 1, "normal": 2, "limited": 3, "other": 4}
STD_FIELDS = ["Patient Name", "Date", "Age / Sex", "Referred By"]


def load_json(p, default):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def slug(s):
    s = re.sub(r"[^A-Za-z0-9]+", "-", s.strip()).strip("-").lower()
    return s or "x"


def clean(t):
    t = t.replace(" ", " ").replace("\t", " ")
    return re.sub(r"[ ]{2,}", " ", t).strip()


def _n(t):
    """تطبيع النص للمقارنة (يتجاهل ▪ والمسافات والنقطتين)."""
    t = t.replace("▪", " ").replace("\u00a0", " ").replace("\t", " ")
    return re.sub(r"\s+", " ", t).strip(" :").lower()


def raw_paragraph_texts(doc):
    """كل نصوص الملف بما فيها الجداول والصناديق النصية (للتحقق أنه لم يضِع شيء)."""
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    out = []
    for p in doc.element.body.iter(ns + "p"):
        t = "".join(x.text or "" for x in p.iter(ns + "t"))
        if t.strip():
            out.append(t)
    return out


def check_lost(path, doc, captured, warnings):
    """يقارن كل فقرة في الملف بما التقطه المحلّل؛ أي فقرة لم تُلتقط تُسجَّل كتنبيه."""
    cap = [_n(c) for c in captured]
    joined = "\n".join(cap)
    for t in raw_paragraph_texts(doc):
        n = _n(t)
        if n and n not in cap and n not in joined:
            warnings.append(f"نص مفقود في {path.parent.name}/{path.name}: «{t.strip()[:90]}»")


def info(pa):
    """يرجع (نص, هل بند قائمة, هل منزاح, هل غامق كله, هل منتصف)."""
    ppr = pa._p.pPr
    is_li = ppr is not None and ppr.numPr is not None
    ind = pa.paragraph_format.left_indent
    runs = [r for r in pa.runs if r.text.strip()]
    bold = bool(runs) and all(r.bold for r in runs)
    center = pa.alignment == 1
    return pa.text, is_li, bool(ind and ind.mm > 1), bold, center


def parse_report(path, warnings=None):
    d = docx.Document(path)
    fields, title, blocks, closing = [], None, [], []
    for pa in d.paragraphs:
        raw, is_li, indented, bold, center = info(pa)
        t = clean(raw)
        if title is None:
            if center and bold and t:
                title = t
            elif t:
                fields.append(t.strip(" :"))
            continue
        if t.startswith("▪"):
            blocks.append({"t": "h2" if indented else "h1", "x": t.lstrip("▪ ").strip()})
        elif is_li:
            blocks.append({"t": "li", "x": t})
        elif t:
            closing.append(t)
    fields = [f for f in fields if f]
    if warnings is not None:
        if title is None:
            warnings.append(f"{path.name}: لم يُعثر على عنوان (سطر مركزي غامق)")
        check_lost(path, d, fields + ([title] if title else []) + [b["x"] for b in blocks] + closing, warnings)
    out = {"title": title or path.stem.replace("_", " "), "blocks": blocks}
    if fields and fields != STD_FIELDS:
        out["fields"] = fields
    if closing:
        out["closing"] = closing
    return out


SUB_KINDS = [
    ("indication", re.compile(r"indication", re.I)),
    ("impression", re.compile(r"impression|conclusion", re.I)),
    ("technique", re.compile(r"technique", re.I)),
    ("findings", re.compile(r"^findings?\b", re.I)),
]


def sub_kind(title):
    for k, rx in SUB_KINDS:
        if rx.search(title):
            return k
    return ""


def parse_bank(path, warnings=None):
    d = docx.Document(path)
    bank_title, groups = "", []
    g = s = None
    for pa in d.paragraphs:
        raw, is_li, indented, bold, center = info(pa)
        t = clean(raw)
        if not t and not is_li:
            continue
        if t.startswith("▪"):
            text = t.lstrip("▪ ").strip().rstrip(":").strip()
            if indented and g is not None:
                s = {"title": text, "kind": sub_kind(text), "items": []}
                g["subs"].append(s)
            else:
                g = {"title": text, "subs": [], "items": []}
                groups.append(g)
                s = None
        elif is_li:
            if not t:
                continue
            if g is None:
                g = {"title": "General", "subs": [], "items": []}
                groups.append(g)
            (s["items"] if s is not None else g["items"]).append(t)
        elif not bank_title:
            bank_title = t
        elif g is not None:      # فقرة عادية داخل مجموعة: نحتفظ بها كتعبير حتى لا يضيع نص
            (s["items"] if s is not None else g["items"]).append(t)
    if warnings is not None:
        cap = [bank_title] if bank_title else []
        for g in groups:
            cap += [g["title"]] + g["items"]
            for sb in g["subs"]:
                cap += [sb["title"]] + sb["items"]
        check_lost(path, d, cap, warnings)
    groups = [x for x in groups if x["items"] or any(sb["items"] for sb in x["subs"])]
    return bank_title, groups


def classify_file(stem):
    low = stem.lower()
    if "phrase" in low:
        return "bank", None, None
    kind = "other"
    for k in ("template", "blank", "normal", "limited"):
        if k in low:
            kind = k
            break
    layout = ""
    if "prominent_lead" in low or "prominent lead" in low:
        layout = "Prominent Lead"
    elif "standard" in low:
        layout = "Standard"
    return "variant", kind, layout


STOP = {"template", "blank", "normal", "limited", "standard", "prominent", "lead", "us", "ultrasound", "report", "reports", "docx"}


def name_duplicates(variants):
    """عند وجود أكثر من ملف من نفس النوع (مثلاً عدة Normal) نستخرج من اسم الملف ما يميّز كل واحد ليظهر في قائمة النسخ."""
    groups = {}
    for v in variants:
        groups.setdefault((v["kind"], v["layout"]), []).append(v)
    for (kind, layout), vs in groups.items():
        if len(vs) > 1:
            toks = [[t for t in re.split(r"[_\s\-]+", v["_stem"]) if t and t.lower() not in STOP] for v in vs]
            common = set.intersection(*[set(t.lower() for t in x) for x in toks])
            for v, tk in zip(vs, toks):
                if v["_ovr"]:
                    continue
                q = " ".join(t for t in tk if t.lower() not in common).strip()
                if q:
                    v["label"] = kind.capitalize() + (f" · {layout}" if layout else "") + " · " + q.replace("_", " ")
        seen = {}
        for v in vs:
            seen[v["label"]] = seen.get(v["label"], 0) + 1
        dup = {k for k, n in seen.items() if n > 1}
        idx = {}
        for v in vs:
            if v["label"] in dup:
                idx[v["label"]] = idx.get(v["label"], 0) + 1
                v["label"] += f" {idx[v['label']]}"
    for v in variants:
        v.pop("_stem", None)
        v.pop("_ovr", None)


def build():
    modalities_cfg = load_json(DATA / "modalities.json", {})
    meta = load_json(DATA / "catalog-meta.json", {"groups": {}, "studies": {}})
    studies_meta = meta.get("studies", {})
    groups_meta = meta.get("groups", {})

    for old in DATA.glob("*/*.json"):
        old.unlink()

    studies_index, mods_found, warnings = [], {}, []
    for mod_dir in sorted(p for p in ROOT.iterdir() if p.is_dir()):
        m = re.match(r"^(.+?)\s+REPORTS$", mod_dir.name)
        if not m:
            continue
        mod_name = m.group(1).strip()
        cfg = modalities_cfg.get(mod_name.upper()) or modalities_cfg.get(mod_name) or {}
        mod_id = cfg.get("id") or slug(mod_name)
        mods_found[mod_name.upper()] = mod_id
        (DATA / mod_id).mkdir(parents=True, exist_ok=True)

        for folder in sorted(p for p in mod_dir.iterdir() if p.is_dir()):
            sm = studies_meta.get(folder.name, {})
            order_m = re.match(r"^(\d+)", folder.name)
            order = int(order_m.group(1)) if order_m else 999
            pretty = re.sub(r"^\d+[_\s-]*", "", folder.name).replace("_", " ").strip().title()
            variants, bank, bank_title, files = [], [], "", []
            for f in sorted(folder.glob("*.docx")):
                if f.name.startswith("~$"):
                    continue
                files.append(f.name)
                typ, kind, layout = classify_file(f.stem)
                try:
                    if typ == "bank":
                        bank_title, bank = parse_bank(f, warnings)
                    else:
                        rep = parse_report(f, warnings)
                        label_override = (sm.get("variant_labels") or {}).get(f.stem)
                        label = label_override or kind.capitalize() + (f" · {layout}" if layout else "")
                        if kind == "other" and not label_override:
                            label = f.stem.replace("_", " ")
                        vid = kind + (f"-{slug(layout)}" if layout else "")
                        if any(v["id"] == vid for v in variants):
                            vid += "-" + slug(f.stem)[-6:]
                        if not rep["blocks"]:
                            warnings.append(f"{f.name}: لا توجد بنود")
                        variants.append({"id": vid, "kind": kind, "layout": layout, "label": label, "_stem": f.stem, "_ovr": bool(label_override), **rep})
                except Exception as e:  # noqa
                    warnings.append(f"{f.name}: تعذّرت القراءة ({e})")
            if not variants and not bank:
                continue
            name_duplicates(variants)
            variants.sort(key=lambda v: (KIND_ORDER.get(v["kind"], 9), v["layout"], v["id"]))
            sid = f"{mod_id}-{slug(folder.name)}"
            study = {
                "id": sid, "modality": mod_id, "folder": folder.name, "order": order,
                "title": sm.get("title") or pretty, "title_ar": sm.get("title_ar", ""),
                "group": sm.get("group", "other"), "keywords": sm.get("keywords", []),
                "variants": variants, "bank_title": bank_title, "bank": bank,
                "source": files,
            }
            rel = f"{mod_id}/{slug(folder.name)}.json"
            (DATA / rel).write_text(json.dumps(study, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            n_items = sum(len(g["items"]) + sum(len(s["items"]) for s in g["subs"]) for g in bank)
            studies_index.append({
                "id": sid, "modality": mod_id, "order": order, "title": study["title"],
                "title_ar": study["title_ar"], "group": study["group"], "keywords": study["keywords"],
                "variants": [{"id": v["id"], "kind": v["kind"], "layout": v["layout"], "label": v["label"]} for v in variants],
                "bank_cases": len(bank), "bank_items": n_items, "file": rel,
            })
            if study["group"] == "other" and folder.name not in studies_meta:
                warnings.append(f"{folder.name}: لا يوجد سطر له في data/catalog-meta.json (سيظهر في مجموعة 'أخرى')")

    mods = []
    for name, cfg in modalities_cfg.items():
        if name.startswith("_"):
            continue
        mid = cfg["id"]
        cnt = sum(1 for s in studies_index if s["modality"] == mid)
        mods.append({**cfg, "count": cnt, "planned": bool(cfg.get("planned")) and cnt == 0})
    known = {c.get("id") for c in modalities_cfg.values() if isinstance(c, dict)}
    for name, mid in mods_found.items():
        if mid not in known:
            cnt = sum(1 for s in studies_index if s["modality"] == mid)
            mods.append({"id": mid, "name": name.title(), "name_ar": name.title(), "icon": "🩺", "order": 50, "count": cnt, "planned": False})
    mods.sort(key=lambda x: x.get("order", 99))
    studies_index.sort(key=lambda s: (s["modality"], s["order"], s["title"]))

    index = {
        "version": datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d%H%M%S"),
        "modalities": mods,
        "groups": groups_meta,
        "studies": studies_index,
    }
    (DATA / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    n_var = sum(len(s["variants"]) for s in studies_index)
    n_items = sum(s["bank_items"] for s in studies_index)
    print(f"تم: {len(studies_index)} دراسة، {n_var} نموذج، {n_items} تعبير في البنوك")
    for w in warnings:
        print("تنبيه:", w)
    rep = [f"Build report {index['version']}", f"{len(studies_index)} studies, {n_var} variants, {n_items} phrases", ""]
    rep += ([f"WARNING: {w}" for w in warnings] or ["OK: no lost text, no warnings."])
    (DATA / "build-report.txt").write_text("\n".join(rep) + "\n", encoding="utf-8")


if __name__ == "__main__":
    build()
