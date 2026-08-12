"""Board-game grid pipeline.

Turns BoardGameGeek data into a 2-D grid of games indexed by
player count (columns) and complexity/weight (rows). Each cell holds the
best-ranked game of each *archetype* (worker placement, social deduction, ...)
so no two games in a cell play the same way.

Run it with:  python -m pipeline.build          # seed data (offline)
              python -m pipeline.build --live    # fetch live from BGG
"""
