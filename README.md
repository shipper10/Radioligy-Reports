# تقارير الأشعة · Radiology Reports (PWA)

محرر تقارير أشعة يعمل بدون إنترنت: قوالب جاهزة، بنوك تعابير، بحث، تصدير PDF / Word / PNG / نص.

## البنية (Data-Driven)
```
ULTRASOUND  REPORTS/…docx   ← المصدر (يكتبه الأطباء)
tools/build_data.py         ← يحوّل docx إلى JSON
data/                       ← index.json + <modality>/<study>.json + إعدادات (modalities, catalog-meta, branding)
js/ css/ index.html         ← الواجهة (لا تحتوي محتوى طبي)
sw.js manifest.webmanifest  ← PWA
```
إضافة محتوى جديد: راجع [docs/ADDING-REPORTS.md](docs/ADDING-REPORTS.md).

## التشغيل محلياً
`python tools/build_data.py && python -m http.server 8000` ثم افتح http://localhost:8000

## النشر على Vercel
استورد المستودع كـ Static (بدون Build Command، Output = الجذر). الملف `vercel.json` جاهز.

## الخصوصية
المسودات والتوقيع والإعدادات تُحفظ في متصفح المستخدم فقط. من الإعدادات ⚙ نسخ احتياطي/استرجاع.
