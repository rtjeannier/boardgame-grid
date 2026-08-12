"""Offline seed dataset — a curated slice of well-known top BGG games.

This lets the pipeline produce a real, reviewable grid without network access.
Values (rank/weight/best player counts) are hand-entered and *approximate*;
`signals` use BGG's actual mechanic/category names so the archetype matching
here is identical to the live path. Run `python -m pipeline.build --live` to
replace all of this with current BGG data.

Each row: (id, name, year, rank, weight, best_counts, signals)
"""

from .buckets import peak_count
from .model import Game

_SEED = [
    # --- Heavy / brain-burner ------------------------------------------------
    (174430, "Gloomhaven", 2017, 1, 3.9, [2, 3], ["Cooperative Game", "Hand Management", "Modular Board"]),
    (224517, "Brass: Birmingham", 2018, 2, 3.9, [3, 4], ["Network and Route Building", "Hand Management"]),
    (342942, "Ark Nova", 2021, 3, 3.7, [2, 3], ["Open Drafting", "Set Collection", "End Game Bonuses"]),
    (233078, "Twilight Imperium: Fourth Edition", 2017, 5, 4.3, [6], ["Area Majority / Influence", "Auction/Bidding", "Negotiation"]),
    (220308, "Gaia Project", 2017, 8, 4.4, [2, 3], ["Area Majority / Influence", "Tile Placement", "Network and Route Building"]),
    (182028, "Through the Ages: A New Story of Civilization", 2015, 12, 4.4, [3], ["Engine Building", "Hand Management", "Auction/Bidding"]),
    (177736, "A Feast for Odin", 2016, 14, 3.9, [3], ["Worker Placement", "Tile Placement"]),
    (251247, "Barrage", 2019, 20, 3.9, [3, 4], ["Worker Placement", "Network and Route Building"]),
    (96848, "Mage Knight Board Game", 2011, 25, 4.2, [1], ["Deck, Bag, and Pool Building", "Hand Management", "Hexagon Grid"]),
    (162886, "Spirit Island", 2017, 6, 4.0, [1, 2, 3], ["Cooperative Game", "Area Majority / Influence", "Variable Player Powers"]),

    # --- Heavy-medium --------------------------------------------------------
    (167791, "Terraforming Mars", 2016, 4, 3.2, [3], ["Engine Building", "Open Drafting", "Tile Placement"]),
    (193738, "Great Western Trail", 2016, 15, 3.7, [3, 4], ["Deck, Bag, and Pool Building", "Network and Route Building"]),
    (169786, "Scythe", 2016, 18, 3.4, [4, 5], ["Area Majority / Influence", "Engine Building"]),
    (316554, "Dune: Imperium", 2020, 7, 3.0, [3, 4], ["Deck, Bag, and Pool Building", "Worker Placement"]),
    (199792, "Everdell", 2018, 22, 2.8, [3, 4], ["Worker Placement", "Hand Management"]),
    (84876, "The Castles of Burgundy", 2011, 24, 3.0, [2], ["Tile Placement", "Dice Rolling"]),
    (121921, "Robinson Crusoe: Adventures on the Cursed Island", 2012, 40, 3.2, [1, 3, 4], ["Cooperative Game", "Dice Rolling"]),
    (28143, "Race for the Galaxy", 2007, 45, 3.0, [2], ["Engine Building", "Open Drafting", "Set Collection"]),
    (3076, "Puerto Rico", 2002, 48, 3.3, [3, 4, 5], ["Set Collection", "Variable Phase Order"]),

    # --- Medium --------------------------------------------------------------
    (266192, "Wingspan", 2019, 30, 2.4, [2, 3], ["Engine Building", "Open Drafting", "Set Collection"]),
    (312484, "Lost Ruins of Arnak", 2020, 26, 2.9, [2, 3], ["Deck, Bag, and Pool Building", "Worker Placement"]),
    (36218, "Dominion", 2008, 42, 2.4, [2, 3], ["Deck, Bag, and Pool Building"]),
    (30549, "Pandemic", 2008, 110, 2.4, [4], ["Cooperative Game", "Set Collection"]),
    (155821, "Inis", 2016, 55, 2.8, [4], ["Area Majority / Influence", "Closed Drafting"]),
    (269385, "Res Arcana", 2019, 90, 2.5, [2], ["Engine Building", "Hand Management"]),
    (244521, "The Quacks of Quedlinburg", 2018, 60, 2.4, [3, 4], ["Deck, Bag, and Pool Building", "Push Your Luck"]),
    (271324, "It's a Wonderful World", 2019, 130, 2.3, [4], ["Closed Drafting", "Engine Building"]),
    (68448, "7 Wonders", 2010, 65, 2.3, [4, 5, 6, 7], ["Open Drafting", "Set Collection"]),
    (13, "CATAN", 1995, 400, 2.3, [4], ["Network and Route Building", "Dice Rolling", "Trading"]),

    # --- Light-medium --------------------------------------------------------
    (173346, "7 Wonders Duel", 2015, 16, 2.2, [2], ["Open Drafting", "Set Collection"]),
    (230802, "Azul", 2017, 50, 1.8, [2, 4], ["Tile Placement", "Open Drafting", "Pattern Building"]),
    (148228, "Splendor", 2014, 120, 1.8, [2, 3], ["Engine Building", "Set Collection"]),
    (9209, "Ticket to Ride", 2004, 150, 1.8, [4], ["Network and Route Building", "Set Collection"]),
    (822, "Carcassonne", 2000, 170, 1.9, [2], ["Tile Placement", "Area Majority / Influence"]),
    (295947, "Cascadia", 2021, 35, 1.9, [2], ["Tile Placement", "Open Drafting"]),
    (253344, "Cartographers", 2019, 95, 1.9, [2, 3, 4], ["Roll / Spin and Write", "Open Drafting"]),
    (233867, "Welcome To...", 2018, 140, 1.8, [3, 4], ["Flip and Write", "Paper-and-Pencil"]),
    (314491, "The Crew: The Quest for Planet Nine", 2019, 70, 1.9, [3, 4], ["Cooperative Game", "Trick-taking"]),

    # --- Light / party / social ---------------------------------------------
    (521, "Crokinole", 1876, 80, 1.1, [2, 4], ["Flicking", "Action / Dexterity"]),
    (163412, "Patchwork", 2014, 75, 1.6, [2], ["Tile Placement"]),
    (54043, "Jaipur", 2009, 100, 1.5, [2], ["Open Drafting", "Set Collection"]),
    (244522, "That's Pretty Clever!", 2018, 160, 1.4, [1, 2], ["Roll / Spin and Write", "Push Your Luck"]),
    (306735, "Under Falling Skies", 2020, 180, 2.1, [1], ["Roll / Spin and Write", "Dice Rolling"]),
    (37046, "Friday", 2011, 260, 2.0, [1], ["Deck, Bag, and Pool Building"]),
    (192291, "Sushi Go Party!", 2016, 190, 1.5, [4, 5], ["Open Drafting", "Set Collection"]),
    (12942, "No Thanks!", 2004, 210, 1.1, [5, 6, 7], ["Push Your Luck", "Set Collection"]),
    (92415, "Skull", 2011, 230, 1.3, [5, 6], ["Push Your Luck", "Bluffing"]),
    (254640, "Just One", 2018, 145, 1.1, [5, 6, 7], ["Cooperative Game", "Party Game", "Word Game"]),
    (178900, "Codenames", 2015, 85, 1.3, [6, 7, 8], ["Word Game", "Party Game"]),
    (225694, "Decrypto", 2018, 135, 1.8, [6], ["Word Game", "Deduction", "Party Game"]),
    (131357, "Coup", 2012, 220, 1.4, [4, 5], ["Hidden Roles", "Player Elimination"]),
    (128882, "The Resistance: Avalon", 2012, 105, 1.7, [7, 8, 9, 10], ["Hidden Roles", "Voting"]),
    (223040, "Secret Hitler", 2016, 155, 1.7, [8, 9, 10], ["Hidden Roles", "Voting"]),
    (147949, "One Night Ultimate Werewolf", 2014, 240, 1.3, [7, 8, 9, 10], ["Hidden Roles", "Deduction"]),
]


def seed_games() -> list[Game]:
    return [Game(id, name, year, rank, weight, best, peak_count(best), signals)
            for (id, name, year, rank, weight, best, signals) in _SEED]
