// Genre dimension names arrive from the pipeline as a few BGG tags joined
// together, e.g. "Action / Dexterity · Stacking and Balancing".
//
// The separator is NOT " / ": BGG's own tag names contain that string
// ("Action / Dexterity", "Murder / Mystery", "Scenario / Mission / Campaign
// Game"), so splitting on it truncated the dexterity axis to "Action". Keep
// this in step with GENRE_NAME_SEPARATOR in pipeline/config.py.
export const SEPARATOR = ' · '

// The leading tag — what an axis is called when there is only room for one.
export const primary = (dimension) => dimension.split(SEPARATOR)[0]
