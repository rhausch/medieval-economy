# Performance baseline

Measured with `npm run bench` on the milestone 6 build, on an AMD Ryzen 7 7800X3D (8 cores, WSL2 on Windows 11), Node 22, seed 1, 300 ticks after 100 warm-up ticks, 256x256 world, ecology every tick. Raw numbers are saved as JSON in `experiments/output/` (git-ignored). Re-run after any change that touches the ecology, the Folk engine or a decider, and compare.

## Throughput by Folk count (256x256)

| Deciders | Folk | ticks/s | ms/tick | ecology ms | Folk ms | us per Folk-tick | decisions/tick |
| -------- | ---- | ------- | ------- | ---------- | ------- | ---------------- | -------------- |
| rules    | 20   | 254     | 3.94    | 3.89       | 0.04    | 2.1              | 18.9           |
| rules    | 100  | 246     | 4.06    | 3.93       | 0.12    | 1.2              | 91.9           |
| rules    | 500  | 226     | 4.42    | 3.87       | 0.55    | 1.1              | 456.2          |
| rules    | 2000 | 161     | 6.19    | 3.86       | 2.34    | 1.2              | 1660.5         |
| rules    | 5000 | 115     | 8.69    | 3.83       | 4.87    | 1.0              | 2736.8         |
| utility  | 20   | 263     | 3.80    | 3.77       | 0.03    | 1.5              | 17.4           |
| utility  | 100  | 265     | 3.77    | 3.68       | 0.09    | 0.9              | 86.4           |
| utility  | 500  | 247     | 4.04    | 3.64       | 0.40    | 0.8              | 435.9          |
| utility  | 2000 | 164     | 6.11    | 3.68       | 2.43    | 1.2              | 1584.2         |
| utility  | 5000 | 77      | 12.93   | 3.68       | 9.25    | 1.8              | 3098.5         |
| mixed    | 20   | 275     | 3.63    | 3.61       | 0.02    | 1.2              | 18.1           |
| mixed    | 100  | 269     | 3.72    | 3.62       | 0.10    | 1.0              | 90.3           |
| mixed    | 500  | 246     | 4.07    | 3.62       | 0.45    | 0.9              | 447.9          |
| mixed    | 2000 | 163     | 6.12    | 3.68       | 2.44    | 1.2              | 1627.9         |
| mixed    | 5000 | 81      | 12.38   | 3.65       | 8.72    | 1.7              | 3247.6         |

## Large world (1024x1024, about 1M tiles), mixed deciders, 60 ticks

| Folk | ticks/s | ms/tick | ecology ms | Folk ms |
| ---- | ------- | ------- | ---------- | ------- |
| 20   | 17      | 60.41   | 60.28      | 0.12    |
| 500  | 16      | 61.46   | 60.93      | 0.53    |

The two tables were measured in separate processes that overlapped in time; re-running three of the configurations alone gave results within about 5% (mixed, 500 Folk: 242 vs 246 ticks/s; 5000 Folk: 84 vs 81; 1024x1024 with 20 Folk: 18 vs 17).

## What it shows

- The ecology is the cost: about 3.7 ms per tick at 256x256 and about 60 ms at 1024x1024, independent of Folk count. At 20 to 500 Folk it is over 85% of a tick.
- The Folk phase scales linearly at about 1 to 2 microseconds per Folk per tick, so 5000 Folk add 5 to 9 ms. Both deciders are cheap; utility costs about 1.5x rules at 5000 Folk, mostly because it walks farther and so does longer searches.
- A decider's own `decide()` is below the timer's resolution floor (about 1.2 us) at the median and 99th percentile; the shared search for work has a p95 of 3 to 13 us. Tails of hundreds of microseconds are rare and most likely garbage collection.
- Real time (10 ticks/s) is comfortable everywhere measured. The first limit to hit will be the ecology on very large worlds; `ecologyInterval` (run it every N ticks) is the lever, or moving its update to a worker thread or the GPU.
- Not yet measured: heavier deciders (planning), perception and memory, and the cost of streaming resources to the client at 1M tiles.

## After F2 (movement and goals)

Mixed deciders, 256x256, 200 ticks: 20 Folk 273 ticks/s, 500 Folk 238, 2000 Folk 171, 5000 Folk 113 (the tables above were measured before F1 and F2). Decisions per tick fell about fourfold (5000 Folk: 858 against 3,247) because Folk walk and stroll toward goals instead of deciding every tick, which more than paid for the costlier walking-time search (search p95 up from about 3 microseconds to a few tens). The ecology (about 3.7 ms per tick) remains the cost that does not scale with Folk.

## After F3 (sparse patchy food)

The ecology only updates tiles a species lives on and runs every 10 ticks, and grass exists only under the animals. Mixed deciders: at 256x256 with 20 Folk the whole simulation runs at about 2,650 ticks per second (0.38 ms per tick, ecology 0.19 ms); at 1024x1024 the ecology costs about 4.8 ms per tick (it was 60) and the run about 170 ticks per second. The Folk phase, however, got costlier because food is sparse: each decision's walking-time search now takes about 100 to 350 microseconds (it was about 1), so 500 Folk take about 12 ms per tick and 2,000 Folk about 75 ms. The search budget (`folk.searchTicks`, default 90) trades survival against cost only in proportion (25 ticks cuts it about 2.5 times). Perception and memory (F4) removes the search.

## After F4 (perception and memory)

Decisions no longer search the map: a Folk reads its remembered places (an estimated straight-line walk each) and only the chosen place is routed (A*). Decision time is about 1.4 microseconds (100 to 350 in F3) and the Folk phase about 2 to 4 microseconds per Folk per tick. Mixed deciders at 256x256: 20 Folk 4,100 ticks per second, 500 Folk 850, 2,000 Folk 144 (13 in F3), 5,000 Folk 55. At 1024x1024 with 20 Folk 200 ticks per second (ecology 4.9 ms), at 2048x2048 28 (ecology 35 ms): the ecology, now proportional to the number of patch tiles, is the cost at very large sizes, and `ecology.interval` is the lever.
