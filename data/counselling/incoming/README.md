# Add counselling results here

1. Open https://mcc.nic.in/pg-medical-counselling/ and download the **Final Allotment Result** PDF for the new round
   (for example "Final Allotment Result for PG Counselling Round 2 dated …").
2. On GitHub, open this folder → **Add file → Upload files** → drop the PDF → **Commit changes**.

That's all. The "Counselling data" action reads it within a few minutes, updates `data/counselling/`, and removes the PDF.
Mochi's counselling helper picks up the new round the next time it's opened. Any file name works: the year and round
are read from the PDF itself.
