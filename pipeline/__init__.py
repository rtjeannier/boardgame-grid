"""Board-game grid pipeline.

Turns BoardGameGeek data into a 2-D grid of games indexed by player count
(columns) and complexity/weight (rows). Each cell holds a subset chosen to
*cover* a continuous game space, so no two games in a cell are near-identical
however well-ranked both are. The genre axes that space is built from are mined
from BGG's mechanic and category tags rather than hand-written — see
`features.py`.

Run it with:  python -m pipeline.build                        # seed data, offline
              python -m pipeline.build --dataset data/games.json
              python -m pipeline.build --report               # the four numbers
              python -m pipeline.fetch --limit 5000           # refresh from BGG
"""
