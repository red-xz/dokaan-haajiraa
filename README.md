# Shop Attendance

<p align="center">
  <img src="assets/screenshot-home-390.jpg" alt="Shop Attendance home screen" width="300">
</p>

**Attendance and salary for small shops — no spreadsheets.**

Live now: **[dokaan-haajiraa.web.app](https://dokaan-haajiraa.web.app)** · No sign-in needed · Works on any phone browser

GPS check-in within 100 m of the shop · salary ÷ 30 = daily wage · Friday is the paid weekly holiday · each shop gets its own 6-letter code.

## How it works

1. **Shop owner creates a shop** — sets the shop location once, gets a unique
   6-letter shop code.
2. **Employees join with the code** — no account, no password. They open the
   link in their phone browser.
3. **Check-in from the shop only** — GPS must be within 100 m, so attendance
   is real, not remote.
4. **Salary computes itself** — monthly salary ÷ 30 = daily wage; absent and
   leave days unpaid; Friday paid; advances deducted automatically.

## Features

- **Multi-shop** — anyone can create their own shop; separate code and data
  per shop
- **GPS check-in (100 m radius)** — admin sets the location once, at the shop
- **Salary math built in** — daily wage, payable amount, advances, Friday
  holiday — all automatic
- **Monthly attendance view** — who came, who was absent, who is on leave
- **No sign-in for employees** — open the link, join with the code, done
- **Add to Home Screen** — installs like an app from the phone browser

## Quickstart

```bash
git clone https://github.com/red-xz/dokaan-haajiraa.git
cd dokaan-haajiraa
python3 -m http.server 8000
# open http://localhost:8000 — create a shop and try it
```

To run your own copy with live data, create a free Firebase project (Spark
plan) and fill in `firebase-config.js`, then
`firebase deploy --only hosting,firestore:rules`.

## Tech

Plain HTML/CSS/JS — no build step, no framework. Firebase (Firestore +
Anonymous Auth + Hosting) on the free Spark plan. Designed for low-end
phones and small shop owners.

## License

MIT — see `LICENSE`.

---

If this saves a shop owner an evening of spreadsheet math, star it ⭐.
