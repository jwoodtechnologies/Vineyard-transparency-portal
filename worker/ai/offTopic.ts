/**
 * Questions that have nothing to do with Vineyard ("what's the weather in Paris", sports scores,
 * general trivia) get one short line instead of a search through city records. Deliberately
 * conservative: a message that mentions Vineyard, Utah or anything the city does is never caught.
 * Pure: no Worker types.
 */

export const OFF_TOPIC_REPLY = 'This portal covers Vineyard city records only.';

/** Places far from Vineyard. Utah places (Orem, Provo, Utah Lake, Salt Lake) are not on this list. */
const FAR_PLACE =
  /\b(paris|london|tokyo|new york|nyc|los angeles|chicago|san francisco|seattle|boston|miami|houston|dallas|atlanta|phoenix|las vegas|denver|washington,? d\.?c\.?|toronto|vancouver|mexico city|berlin|madrid|rome|moscow|beijing|shanghai|hong kong|sydney|melbourne|dubai|singapore|bangkok|cairo|istanbul|amsterdam|dublin|barcelona|france|germany|italy|spain|england|britain|united kingdom|uk|ireland|china|japan|korea|india|russia|ukraine|brazil|argentina|australia|canada|mexico|egypt|europe|asia|africa|south america|antarctica|california|texas|florida|new jersey|hawaii|alaska)\b/i;

/** Sports results and fixtures. */
const SPORTS = /\b(nba|nfl|mlb|nhl|mls|ncaa|super bowl|world cup|world series|stanley cup|premier league|champions league|olympics?|playoffs?|box score|final score|game score|scores?|standings|touchdowns?|who won the (game|match|series|championship|cup|bowl))\b/i;

/** General knowledge and chit-chat that no city record answers. */
const TRIVIA =
  /\b(capital of|population of (?!vineyard)|who (invented|discovered|painted|composed|wrote the book)|tallest (mountain|building)|longest river|eiffel tower|mount everest|speed of light|meaning of life|recipes?|how (do|can) i (cook|bake)|stock price|share price|bitcoin|ethereum|crypto(currency)?|exchange rate|horoscope|lyrics|tell me a joke|movie (times|showtimes|recommendations?)|celebrit(y|ies)|president of (the united states|france|russia|china|mexico)|translate .+ (into|to) (french|spanish|german|chinese|japanese)|weather (in|for) )\b/i;

/** Anything that ties a message to Vineyard or to what a city does. */
const LOCAL =
  /\b(vineyard|utah|orem|lindon|provo|lehi|american fork|geneva|city|council|mayor|town|municipal|park|parks|lake|road|roads|street|trail|library|police|sheriff|fire|school|water|sewer|trash|garbage|recycling|permits?|zoning|ordinance|resolution|budget|tax|taxes|meeting|minutes|agenda|rda|records?|documents?|residents?|snow|plow|construction|business licen[cs]e|election|ballot|vote|voting|alerts?|emergency|flood|recreation|rec center|league sign|registration)\b/i;

/** True when the message is clearly about something other than Vineyard. */
export function isOffTopic(question: string): boolean {
  const q = question.replace(/[‘’]/g, "'").trim();
  if (!q || q.length > 200) return false;
  if (/\bvineyard\b/i.test(q)) return false;
  if (SPORTS.test(q)) return !LOCAL.test(q) || /\b(nba|nfl|mlb|nhl|mls|ncaa|super bowl|world cup|world series|stanley cup|premier league|champions league)\b/i.test(q);
  if (FAR_PLACE.test(q)) return !/\b(council|mayor|ordinance|resolution|budget|minutes|agenda|rda|permits?|zoning|sister city|vineyard)\b/i.test(q);
  if (TRIVIA.test(q)) return !LOCAL.test(q);
  return false;
}
