{-# LANGUAGE OverloadedStrings #-}
module Inflation (nominalToRealInflationAdjuster) where

-- InflationAdjuster
-- Author: gwern
-- Date: 2019-04-27
-- When:  Time-stamp: "2023-05-09 17:13:36 gwern"
-- License: CC-0
--
-- Experimental Pandoc module for fighting <https://en.wikipedia.org/wiki/Money_illusion> by
-- implementing automatic inflation adjustment of nominal date-stamped dollar or Bitcoin amounts to
-- provide real prices; Bitcoin's exchange rate has moved by multiple orders of magnitude over its
-- early years (rendering nominal amounts deeply unintuitive), and this is particularly critical in
-- any economics or technology discussion where a nominal price from 1950 is 11x the 2019 real
-- price! (Misunderstanding of inflation may be getting worse over time:
-- <https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3469008> )
--
-- Years/dates are specified in a variant of my interwiki link syntax; for example: '[$50]($2000)'
-- or '[₿0.5](₿2017-01-01)'. Dollar amounts use year, and Bitcoins use full dates, as the greater
-- temporal resolution is necessary. Inflation rates/exchange rates are specified in Inflation.hs
-- and need to be manually updated every once in a while; if out of date, the last available rate is
-- carried forward for future adjustments.
--
-- Dollars are inflation-adjusted using the CPI from 1913 to 1958, then the Personal Consumption
-- Expenditures (PCE) Index thereafter, which is recommended by the Federal Reserve and others as
-- more accurately reflecting consumer behavior & welfare than the CPI.
--
-- Bitcoins are exchange-rate-adjusted using a mix of Pizza Day, historical exchange rates, and
-- Poloniex daily dumps, and their dollar-equivalent inflation-adjusted to the current year. Rates
-- are linearly interpolated for missing in-between dates, and carried forwards/backwards when
-- outside of the provided dataset of daily exchange rates.

{- Examples:
Markdown → HTML:

'[$50.50]($1970)'
→
'<span class="inflation-adjusted" data-year-original="1970" data-amount-original="50.50" data-year-current="2019" data-amount-current="343.83">$50.50<sub>1970</sub><sup>$343.83</sup></span>'

Testbed:

Dollar inflation example:

$ echo '[$50.50]($1970)' | pandoc -w native
[Para [Link ("",[],[]) [Str "$50.50"] ("$1970","")]]

> nominalToRealInflationAdjuster $ Link ("",[],[]) [Str "$50.50"] ("$1970","")
Span ("",["inflation-adjusted"],[("year-original","1970"),("amount-original","50.50"),("year-current","2020"),("amount-current","231.18"),("title","CPI inflation-adjusted US dollar: from nominal $50.50 in 1970 \8594 real $231.18 in 2020")]) [Str "$231.18",Span ("",["subsup"],[]) [Superscript [Str "$50.50"],Subscript [Str "1970"]]]

$ echo '' | pandoc -f native -w html
<span class="inflation-adjusted" data-year-original="1970" data-amount-original="50.50" data-year-current="2020" data-amount-current="231.18" title="CPI inflation-adjusted US dollar: from nominal $50.50 in 1970 → real $231.18 in 2020">$231.18<span class="subsup"><sub>1970</sub><sup>$50.50</sup></span></span>

Bitcoin deflation example:

$ echo '[₿50.50](₿2017-01-1)' | pandoc -w native
[Para [Link ("",[],[]) [Str "\8383\&50.50"] ("\8383\&2017-01-1","")]]

> :set -XOverloadedStrings
> bitcoinAdjuster (Link ("",[],[]) [Str "\8383\&50.50"] ("\8383\&2017-01-01",""))
Span ("",["inflation-adjusted"],[("year-original","2017-01-01"),("amount-original","50.50"),("year-current","2020"),("amount-current","56,617"),("title","Exchange-rate-adjusted currency: \8383\&50.50 in 2017-01-01 \8594 $56,617")]) [Str "$56,617",Span ("",["subsup"],[]) [Superscript [Str "\8383\&50.50"],Subscript [Str "2017"]]]

$  echo 'Span ("",["inflation-adjusted"],[("year-original","2017-01-01"),("amount-original","50.50"),("year-current","2020"),("amount-current","56,617"),("title","Inflation-adjusted currency: from \8383\&50.50 in 2017-01-01 \8594 $56,617 in 2020")]) [Str "\\$56,617",Math InlineMath "_{\\text{2017}}^{\\text{\8383\&50.50}}"]' | pandoc -f native -w html
<span class="inflation-adjusted" data-year-original="2017-01-01" data-amount-original="50.50" data-year-current="2020" data-amount-current="56,617" title="Exchange-rate-adjusted currency: ₿50.50 in 2017-01-01 → $56,617">$56,617<span class="subsup"><sub>2017</sub><sup>₿50.50</sup></span></span>
-}

import Text.Pandoc (Inline(Code, Link, Span, Str, Subscript, Superscript))
import Text.Read (readMaybe)
import qualified Data.Map.Strict as M (findMax, findMin, lookup, lookupGE, lookupLE, mapWithKey, Map)
import qualified Data.Text as T (head, length, pack, unpack, tail)

import Utils (currentYear)
import Config.Inflation as C

nominalToRealInflationAdjuster :: Inline -> Inline
nominalToRealInflationAdjuster x@(Link _ _ ("", _)) = error $ "Inflation adjustment (Inflation.hs: nominalToRealInflationAdjuster) failed on malformed link: " ++ show x
nominalToRealInflationAdjuster x@(Link _ _ (ts, _))
  | t == '$' = dollarAdjuster x
  | t == '\8383' = bitcoinAdjuster x --- official Bitcoin Unicode: '₿'/'\8383'; obsoletes THAI BAHT SIGN
  where t = T.head ts
nominalToRealInflationAdjuster x = x

-- TODO: refactor dollarAdjuster/bitcoinAdjuster - they do *almost* the same thing, aside from handling year vs dates
dollarAdjuster :: Inline -> Inline
dollarAdjuster l@(Link _ _ ("", _)) = error $ "Inflation adjustment (dollarAdjuster) failed on malformed link: " ++ show l
dollarAdjuster l@(Link _ text (oldYears, _)) =
  -- if the adjustment is <X%, don't bother, it's not misleading enough yet to need adjusting:
 if (adjustedDollar / oldDollar) < C.minPercentage
 then Str $ T.pack ("$"++ oldDollarString)
 else Span ("", -- no unique identifier available
            ["inflation-adjusted"], -- CSS/HTML class for styling
            -- provide all 4 variables as metadata the <span> tags for possible CSS/JS processing
            [("year-original",oldYear),("amount-original",T.pack oldDollarString),
             ("year-current",T.pack $ show currentYear),("amount-current",T.pack adjustedDollarString),
             ("title", T.pack ("CPI inflation-adjusted US dollar: from nominal $"++oldDollarString'++" in "++T.unpack oldYear++" → real $"++adjustedDollarString++" in "++show currentYear)) ])
      -- [Str ("$" ++ oldDollarString), Subscript [Str oldYear, Superscript [Str ("$"++adjustedDollarString)]]]
      [Str (T.pack $ "$"++adjustedDollarString),  Span ("",["subsup"],[]) [Superscript [Str $ T.pack $ "$" ++ oldDollarString'], Subscript [Str oldYear]]]
    where -- oldYear = '$1970' → '1970'
          oldYear = if T.length oldYears /= 5 || T.head oldYears /= '$' then error (show l) else T.tail oldYears
          oldDollarString = multiplyByUnits $ filter (/= '$') $ inlinesToText text -- '$50.50' → '50.50'; '$50.50k' → '50500.0'; '$50.50m' → 5.05e7; '$50.50b' → 5.05e10; '$50.50t' → 5.05e13
          oldDollar = case (readMaybe (filter (/=',') oldDollarString) :: Maybe Float) of
                        Just d -> d
                        Nothing -> error (show l)
          oldDollarString' = show oldDollar
          adjustedDollar = dollarAdjust oldDollar (T.unpack oldYear)
          adjustedDollarString = show adjustedDollar
          multiplyByUnits :: String -> String
          multiplyByUnits "" = error $ "Inflation.hs (dollarAdjuster): an empty amount was processed from 'text' variable. Original input: " ++ show l
          multiplyByUnits amount = let (unit, rest) = (last amount, read (init amount) :: Float) in -- eg. '100m' → ('m',"100")
                                     if unit `elem` ("0123456789"::String) then amount else show $ case unit of
                                                                                        'k' -> rest*1000
                                                                                        'm' -> rest*1000000
                                                                                        'b' -> rest*1000000000
                                                                                        't' -> rest*1000000000000
                                                                                        e -> error $ "Inflation.hs (dollarAdjuster:multiplyByUnits): a malformed unit multiplier appeared in 'text' variable. Attempted unit multiplication by '" ++ show e ++ "'; original: " ++ show l

dollarAdjuster x = x

inlinesToText :: [Inline] -> String
inlinesToText = concatMap go
  where go x = case x of
               Str s    -> T.unpack s
               Code _ s -> T.unpack s
               _        -> " "

-- dollarAdjust "5.50" "1950" → "59.84"
dollarAdjust :: Float -> String -> Float
dollarAdjust amount year = case (readMaybe year :: Maybe Int) of
                             Just oldYear -> inflationAdjustUSD amount oldYear currentYear
                             Nothing -> error (show amount ++ " " ++ year)

-- inflationAdjustUSD 1 1950 2019 → 10.88084
-- inflationAdjustUSD 5.50 1950 2019 → 59.84462
inflationAdjustUSD :: Float -> Int -> Int -> Float
inflationAdjustUSD d yOld yCurrent = if yOld>=1913 && yCurrent>=1913 then d * totalFactor else d
  where slice from to xs = take (to - from + 1) (drop from xs)
        percents = slice (yOld-1913) (yCurrent-1913) C.inflationRatesUSD
        rates = map (\r -> 1 + (r/100)) percents
        totalFactor = product rates

bitcoinAdjuster :: Inline -> Inline
bitcoinAdjuster l@(Link _ _ ("", _)) = error $ "Inflation adjustment (bitcoinAdjuster) failed on malformed link: " ++ show l
bitcoinAdjuster l@(Link _ text (oldDates, _)) =
 if (adjustedBitcoin / oldBitcoin) < C.minPercentage
 then Str $ T.pack ("\8383"++oldBitcoinString)
 else Span ("",
            ["inflation-adjusted"],
            [("year-original",oldDate),         ("amount-original",T.pack oldBitcoinString),
             ("year-current",T.pack $ show currentYear), ("amount-current", T.pack adjustedBitcoinString),
             ("title", T.pack ("Exchange-rate-adjusted currency: \8383"++oldBitcoinString++" in "++T.unpack oldDate++" → $"++adjustedBitcoinString)) ])
      [Str (T.pack $ "$"++adjustedBitcoinString),  Span ("",["subsup"],[]) [Superscript text, Subscript [Str (T.pack oldYear)]]]
  where oldDate = if T.length oldDates /= 11 || T.head oldDates /= '\8383' then error (show l) else T.tail oldDates
        oldBitcoinString = filter (/= '\8383') $ inlinesToText text
        oldBitcoin = case (readMaybe (filter (/=',') oldBitcoinString) :: Maybe Float) of
                       Just ob -> ob
                       Nothing -> error (show l)
        oldYear = take 4 $ T.unpack oldDate -- it takes up too much space to display full dates like '2017-01-01'; readers only really need the year; the exact date is provided in the tooltip
        adjustedBitcoin = bitcoinAdjust oldBitcoin (T.unpack oldDate)
        adjustedBitcoinString = show adjustedBitcoin
bitcoinAdjuster x = x

-- convert to historical USD, and then inflation-adjust the then-exchange rate to the present day for a real value
bitcoinAdjust :: Float -> String -> Float
bitcoinAdjust oldBitcoin oldDate = oldBitcoin * bitcoinQuery oldDate

-- Look up USD/₿ daily exchange rate for a given day using a hardwired exchange rate database; due to the extreme volatility of Bitcoin, yearly exchange rates are not precise enough.
-- If the requested date is after the last available date, the last exchange rate is carried forward indefinitely; if the date is inside the database range but not available (due to spotty time-series), linearly interpolate (average) the two nearest rates before & after; if the date is before the first well-known Bitcoin purchase (Pizza Day), carry that backwards indefinitely.
bitcoinQuery :: String -> Float
bitcoinQuery date = case M.lookup date bitcoinUSDExchangeRate of
                      Just rate -> rate
                      -- like inflation rates, we carry forward the last available exchange rate
                      Nothing -> let (lastDate,lastRate) = M.findMax bitcoinUSDExchangeRate in
                                   let (firstDate,firstRate) = M.findMin bitcoinUSDExchangeRate in
                                       if date > lastDate then lastRate else
                                         if date < firstDate then firstRate else
                                           let Just (_,after) = M.lookupGE date bitcoinUSDExchangeRate in
                                             let Just (_,before) = M.lookupLE date bitcoinUSDExchangeRate
                                             in (after + before) / 2

-- the exchange rates are, of course, historical: a 2013 USD/Bitcoin exchange rate is for a *2013* dollar, not a current dollar. So we update to a current dollar.
bitcoinUSDExchangeRate :: M.Map String Float
bitcoinUSDExchangeRate = M.mapWithKey (\dt amt -> inflationAdjustUSD amt (read (take 4 dt)::Int) currentYear) bitcoinUSDExchangeRateHistory

{- This general approach could be applied to many other financial assets.
Stock prices would benefit from being reported in meaningful terms like net real return compared to
an index like the S&P 500, as opposed to being reported in purely nominal terms: how often do we
really care about the absolute return or %, compared to the return over alternatives like the
default baseline of simple stock indexing? Typically, the question is not 'what is the return from
investing in stock X 10 years ago?' but 'what is its return compared to simply leaving my money in
my standard stock index?'. If X returns 70% but the S&P 500 returned 200%, then including any
numbers like '70%' is actively misleading to the reader: it should actually be '−130%' or something,
to incorporate the enormous opportunity cost of making such a lousy investment like X.

Another example of the silliness of not thinking about the use: ever notice those stock tickers in
financial websites like WSJ articles, where every mention of a company is followed by today's stock
return ("Amazon (AMZN: 5%) announced Prime Day would be in July")? They're largely clutter: what
does a stock being up 2.5% on the day I happen to read an article tell me, exactly? But what *could*
we make them mean? In news articles, we have two categories of questions in mind:

1. how it started: How did the efficient markets *react*?

    When people look at stock price movements to interpret whether news is better or worse than
    expected, they are implicitly appealing to the EMH: "the market understands what this means, and
    the stock going up or down tells us what it thinks". So 'tickercruft' is a half-assed implicit
    'event study' (which is only an event if you happen to read it within a few hours of
    publication—if even that). "GoodRx fell −25% when Amazon announced online pharmacy. Wow, that's
    serious!"

    To improve the event study, we make this rigorous: the ticker is meaningful only if it captures
    the *event*. Each use must be time-bracketed: what exact time did the news break & how did the
    stock move in the next ~hour (or possibly day)? Then that movement is cached and displayed
    henceforth. It may not be perfect but it's a lot better than displaying stock movements from
    arbitrarily far in the future when the reader happens to be reading it.
2. How's it been going since then?

    When we read news, to generalize event studies, we are interested in the long-term outcome.
    "It's a bold strategy, Cotton. Let's see how it works out for them." So, similar to considering
    the net return for investment purposes, we can show the (net real index adjusted) return since
    publication. The net is a high-variance but unbiased estimator of every news article, and useful
    to know as foreshadowing: imagine reading an old article with the sentence "VISA welcomes its
    exciting new CEO John Johnson (V: −30%)." This is useful context. V being up 0.1% the day you
    read the article, is not.

Tooling-wise, this is easy to support. They can be marked up the same way, eg. '[AMZN](!N
"2019-04-27")' for Amazon/NASDAQ. For easier writing, since stock tickers tend to be unique (there
are not many places other than stock names that strings like "AMZN" or "TSLA" would appear), the
writer's text editor can run a few thousand regexp query-search-and-replaces (there are only so many
stocks) to transform 'AMZN' → '[AMZN](!N "2019-04-27")' to inject the current day automatically.
(This could also be done by the CMS automatically on sight, assuming first-seen = writing-date,
although with Pandoc this has the disadvantage that round-tripping does not preserve the original
Markdown formatting, and the Pandoc conventions can look pretty strange compared to 'normal'
Markdown—at least mine, anyway.) -}
