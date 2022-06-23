{-# LANGUAGE OverloadedStrings #-}
module Interwiki (convertInterwikiLinks, inlinesToText, wpPopupClasses, interwikiTestSuite) where

import Data.Containers.ListUtils (nubOrd)
import qualified Data.Map as M (fromList, lookup, Map)
import qualified Data.Text as T (append, concat, head, isInfixOf, null, tail, take, toUpper, pack, unpack, Text, isPrefixOf, isSuffixOf, takeWhile)
import Network.URI (parseURIReference, uriPath, uriAuthority, uriRegName)
import qualified Network.URI.Encode as E (encodeTextWith, isAllowed)

import Text.Pandoc (Inline(..), nullAttr)

import Utils (replaceManyT)

-- INTERWIKI PLUGIN
-- This is a simplification of the original interwiki plugin I wrote for Gitit: <https://github.com/jgm/gitit/blob/master/plugins/Interwiki.hs>
-- It's more or less the same thing, but the interwiki mapping is cut down to only the ones I use, and it avoids a dependency on Gitit.
-- | Convert a list of inlines into a string.
inlinesToText :: [Inline] -> T.Text
inlinesToText = T.concat . map go
  where go x = case x of
               -- reached the literal T.Text:
               Str s    -> s
               -- strip & recurse on the [Inline]:
               Emph        x' -> inlinesToText x'
               Underline   x' -> inlinesToText x'
               Strong      x' -> inlinesToText x'
               Strikeout   x' -> inlinesToText x'
               Superscript x' -> inlinesToText x'
               Subscript   x' -> inlinesToText x'
               SmallCaps   x' -> inlinesToText x'
               -- throw away attributes and recurse on the [Inline]:
               Span _      x' -> inlinesToText x' -- eg. [foo]{.smallcaps} -> foo
               Quoted _    x' -> inlinesToText x'
               Cite _      x' -> inlinesToText x'
               Link _   x' _  -> inlinesToText x'
               Image _  x' _  -> inlinesToText x'
               -- throw away attributes, return the literal T.Text:
               Math _      x' -> x'
               RawInline _ x' -> x'
               Code _      x' -> x'
               -- fall through with a blank:
               _        -> " "::T.Text

-- BUG: Escaping bugs with Unicode: eg. [Pāli Canon](!W) / <https://en.wikipedia.org/wiki/P%C4%81li_Canon>
-- but if I simply Network.HTTP.urlEncode the article, that breaks a lot of other stuff (like colons in namespaces)...? What *is* the right way to escape/encode WP article names?
convertInterwikiLinks :: Inline -> Inline
convertInterwikiLinks x@(Link _ []           _) = error $ "Link error: no anchor text‽ " ++ show x
convertInterwikiLinks x@(Link _ _ ("", _))      = x
convertInterwikiLinks x@(Link (ident, classes, kvs) ref (interwiki, article)) =
  if not (T.null article) && T.head article == ' ' then error $ "Link error: tooltip malformed with excess whitespace? " ++ show x else
  if T.head interwiki == '!' then
        case M.lookup (T.tail interwiki) interwikiMap of
                Just url  -> let attr' = (ident,
                                            wpPopupClasses (url `interwikiurl` (if article=="" then inlinesToText ref else article)) ++
                                            classes,
                                           kvs) in
                             case article of
                                  "" -> Link attr' ref (url `interwikiurl` inlinesToText ref, "") -- tooltip is now handled by LinkMetadata.hs
                                  _  -> Link attr' ref (url `interwikiurl` article, "")
                Nothing -> error $ "Attempted to use an interwiki link with no defined interwiki: " ++ show x
  else let classes' = wpPopupClasses interwiki ++ classes in
         if ".wikipedia.org/wiki/" `T.isInfixOf` interwiki then
           Link (ident, classes', kvs) ref (interwiki, article)
              else x
  where
    interwikiurl :: T.Text -> T.Text -> T.Text
    -- normalize links; MediaWiki requires first letter to be capitalized, and prefers '_' to ' '/'%20' for whitespace
    interwikiurl "" _ = error (show x)
    interwikiurl _ "" = error (show x)
    interwikiurl u a = let a' = if ".wikipedia.org/wiki/" `T.isInfixOf` u then T.toUpper (T.take 1 a) `T.append` T.tail a else a in
                         u `T.append` (E.encodeTextWith (\c -> (E.isAllowed c || c `elem` [':','/', '(', ')', ',', '#', '\'', '+'])) $ replaceManyT [("\"", "%22"), ("[", "%5B"), ("]", "%5D"), ("%", "%25"), (" ", "_")] $ deunicode a')
    deunicode :: T.Text -> T.Text
    deunicode = replaceManyT [("‘", "\'"), ("’", "\'"), (" ", " "), (" ", " ")]
convertInterwikiLinks x = x

interwikiTestSuite :: [(Inline, Inline, Inline)]
interwikiTestSuite = map (\(a,b) -> (a, convertInterwikiLinks a, b)) $ filter (\(link1, link2) -> convertInterwikiLinks link1 /= link2) [
  -- !Wikipedia
  (Link nullAttr [Str "Pondicherry"] ("!Wikipedia",""),
    Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Str "Pondicherry"] ("https://en.wikipedia.org/wiki/Pondicherry", ""))
  , (Link nullAttr [Emph [Str "Monty Python's Life of Brian"]] ("!Wikipedia",""),
      Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Emph [Str "Monty Python's Life of Brian"]] ("https://en.wikipedia.org/wiki/Monty_Python's_Life_of_Brian", ""))
  , (Link nullAttr [Str "SHA-1#Attacks"] ("!Wikipedia",""),
      Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Str "SHA-1#Attacks"] ("https://en.wikipedia.org/wiki/SHA-1#Attacks", ""))
  , (Link nullAttr [Str "Bayesian search theory"] ("!Wikipedia","USS Scorpion (SSN-589)#Search: 1968"),
      Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Str "Bayesian search theory"] ("https://en.wikipedia.org/wiki/USS_Scorpion_(SSN-589)#Search:_1968", ""))
  , (Link nullAttr [Str "C++ templates"] ("!Wikipedia","Template (C++)"),
     Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Str "C++ templates"] ("https://en.wikipedia.org/wiki/Template_(C++)", ""))
  , (Link nullAttr [Str "Aaahh!!! Real Monsters"] ("!Wikipedia",""),
    Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Str "Aaahh!!! Real Monsters"] ("https://en.wikipedia.org/wiki/Aaahh%21%21%21_Real_Monsters", ""))
    , (Link nullAttr [Str "Senryū"] ("!Wikipedia",""),
    Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Str "Senryū"] ("https://en.wikipedia.org/wiki/Senry%C5%AB", ""))
    , (Link nullAttr [Str "D&D"] ("!Wikipedia","Dungeons & Dragons"),
    Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Str "D&D"] ("https://en.wikipedia.org/wiki/Dungeons_%26_Dragons", ""))
    , (Link nullAttr [Str "Arm & Hammer"] ("!Wikipedia",""),
    Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Str "Arm & Hammer"] ("https://en.wikipedia.org/wiki/Arm_%26_Hammer", ""))
    , (Link nullAttr [Str "Achaea"] ("!Wikipedia","Achaea, Dreams of Divine Lands"),
    Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Str "Achaea"] ("https://en.wikipedia.org/wiki/Achaea,_Dreams_of_Divine_Lands", ""))
    , (Link nullAttr [Str "Armageddon"] ("!Wikipedia","Armageddon (MUD)"),
    Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Str "Armageddon"] ("https://en.wikipedia.org/wiki/Armageddon_(MUD)", ""))
  , (Link nullAttr [Str "Special:Pondicherry"] ("!Wikipedia",""),
    Link ("", ["backlink-not", "id-not", "link-annotated-not", "link-live-not"], []) [Str "Special:Pondicherry"] ("https://en.wikipedia.org/wiki/Special:Pondicherry", ""))
  , (Link nullAttr [Str "SpecialPondicherry"] ("!Wikipedia",""),
     Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Str "SpecialPondicherry"] ("https://en.wikipedia.org/wiki/SpecialPondicherry", ""))
  , (Link nullAttr [Str "Category:Pondicherry"] ("!Wikipedia",""),
    Link ("", ["backlink-not", "id-not", "link-annotated-not", "link-live"], []) [Str "Category:Pondicherry"] ("https://en.wikipedia.org/wiki/Category:Pondicherry", ""))

  -- !W
  , (Link nullAttr [Str "Jure Robič"] ("!W",""), Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Str "Jure Robič"] ("https://en.wikipedia.org/wiki/Jure_Robi%C4%8D", ""))
  , (Link nullAttr [Str "Pondicherry"] ("!W",""),
    Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Str "Pondicherry"] ("https://en.wikipedia.org/wiki/Pondicherry", ""))
  , (Link nullAttr [Str "Special:Pondicherry"] ("!W",""),
    Link ("", ["backlink-not", "id-not", "link-annotated-not", "link-live-not"], []) [Str "Special:Pondicherry"] ("https://en.wikipedia.org/wiki/Special:Pondicherry", ""))
  , (Link nullAttr [Str "SpecialPondicherry"] ("!W",""),
     Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Str "SpecialPondicherry"] ("https://en.wikipedia.org/wiki/SpecialPondicherry", ""))
  , (Link nullAttr [Str "Category:Pondicherry"] ("!W",""),
    Link ("", ["backlink-not", "id-not", "link-annotated-not", "link-live"], []) [Str "Category:Pondicherry"] ("https://en.wikipedia.org/wiki/Category:Pondicherry", ""))

  -- !W + title
  , (Link nullAttr [Str "foo"] ("!W","Pondicherry"),
    Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Str "foo"] ("https://en.wikipedia.org/wiki/Pondicherry", ""))
  , (Link nullAttr [Str "foo"] ("!W","Special:Pondicherry"),
    Link ("", ["backlink-not", "id-not", "link-annotated-not", "link-live-not"], []) [Str "foo"] ("https://en.wikipedia.org/wiki/Special:Pondicherry", ""))
  , (Link nullAttr [Str "foo"] ("!W","SpecialPondicherry"),
     Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Str "foo"] ("https://en.wikipedia.org/wiki/SpecialPondicherry", ""))
  , (Link nullAttr [Str "foo"] ("!W","Category:Pondicherry"),
    Link ("", ["backlink-not", "id-not", "link-annotated-not", "link-live"], []) [Str "foo"] ("https://en.wikipedia.org/wiki/Category:Pondicherry", ""))

   -- <https://en.wikipedia.org/wiki/$ARTICLE>
  , (Link nullAttr [Str "Pondicherry"] ("https://en.wikipedia.org/wiki/Pondicherry",""),
    Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Str "Pondicherry"] ("https://en.wikipedia.org/wiki/Pondicherry", ""))
  , (Link nullAttr [Str "Special:Pondicherry"] ("https://en.wikipedia.org/wiki/Special:Pondicherry",""),
    Link ("", ["backlink-not", "id-not", "link-annotated-not", "link-live-not"], []) [Str "Special:Pondicherry"] ("https://en.wikipedia.org/wiki/Special:Pondicherry", ""))
  , (Link nullAttr [Str "SpecialPondicherry"] ("https://en.wikipedia.org/wiki/SpecialPondicherry",""),
     Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Str "SpecialPondicherry"] ("https://en.wikipedia.org/wiki/SpecialPondicherry", ""))
  , (Link nullAttr [Str "Category:Pondicherry"] ("https://en.wikipedia.org/wiki/Category:Pondicherry",""),
    Link ("", ["backlink-not", "id-not", "link-annotated-not", "link-live"], []) [Str "Category:Pondicherry"] ("https://en.wikipedia.org/wiki/Category:Pondicherry", ""))

  -- /Lorem testcases: Should popup (as an **annotation**):
  , (Link nullAttr [Emph [Str "Liber Figurarum"]] ("https://it.wikipedia.org/wiki/Liber_Figurarum",""),
     Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Emph [Str "Liber Figurarum"]] ("https://it.wikipedia.org/wiki/Liber_Figurarum", ""))
  , (Link nullAttr [Str "Small caps"] ("!W",""),
    Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Str "Small caps"] ("https://en.wikipedia.org/wiki/Small_caps", ""))
  , (Link nullAttr [Str "Talk:Small caps"] ("!W",""),
    Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Str "Talk:Small caps"] ("https://en.wikipedia.org/wiki/Talk:Small_caps", ""))
  , (Link nullAttr [Str "User:Gwern"] ("!W",""),
    Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Str "User:Gwern"] ("https://en.wikipedia.org/wiki/User:Gwern", ""))
  , (Link nullAttr [Str "User talk:Gwern"] ("!W",""),
    Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Str "User talk:Gwern"] ("https://en.wikipedia.org/wiki/User_talk:Gwern", ""))
  , (Link nullAttr [Str "Help:Authority control"] ("!W",""),
    Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Str "Help:Authority control"] ("https://en.wikipedia.org/wiki/Help:Authority_control", ""))
  , (Link nullAttr [Str "Help talk:Authority control"] ("!W",""),
    Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Str "Help talk:Authority control"] ("https://en.wikipedia.org/wiki/Help_talk:Authority_control", ""))
  , (Link nullAttr [Str "Wikipedia:Wikipedia Signpost"] ("!W",""),
    Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Str "Wikipedia:Wikipedia Signpost"] ("https://en.wikipedia.org/wiki/Wikipedia:Wikipedia_Signpost", ""))
  , (Link nullAttr [Str "Wikipedia talk:Wikipedia Signpost"] ("!W",""),
    Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Str "Wikipedia talk:Wikipedia Signpost"] ("https://en.wikipedia.org/wiki/Wikipedia_talk:Wikipedia_Signpost", ""))
  , (Link nullAttr [Str "Wikipedia talk:Wikipedia Signpost"] ("!W",""),
     Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Str "Wikipedia talk:Wikipedia Signpost"] ("https://en.wikipedia.org/wiki/Wikipedia_talk:Wikipedia_Signpost", ""))
  , (Link nullAttr [Str "File:NASA Worm logo.svg"] ("!W",""),
      Link ("", ["backlink-not", "id-not", "link-annotated-not", "link-live"], []) [Str "File:NASA Worm logo.svg"] ("https://en.wikipedia.org/wiki/File:NASA_Worm_logo.svg", ""))
  , (Link nullAttr [Str "MediaWiki:Citethispage-content"] ("!W",""),
      Link ("", ["backlink-not", "id-not", "link-annotated", "link-live"], []) [Str "MediaWiki:Citethispage-content"] ("https://en.wikipedia.org/wiki/MediaWiki:Citethispage-content", ""))

    -- Should popup (as a **live link** but not annotation): [Category:Buddhism and sports](!W)
  , (Link nullAttr [Str "Category:Buddhism and sports"] ("https://en.wikipedia.org/wiki/Category:Buddhism_and_sports",""),
     Link ("", ["backlink-not", "id-not", "link-annotated-not", "link-live"], []) [Str "Category:Buddhism and sports"] ("https://en.wikipedia.org/wiki/Category:Buddhism_and_sports", ""))
    , (Link nullAttr [Str "Category:Buddhism and sports"] ("!W",""),
     Link ("", ["backlink-not", "id-not", "link-annotated-not", "link-live"], []) [Str "Category:Buddhism and sports"] ("https://en.wikipedia.org/wiki/Category:Buddhism_and_sports", ""))
    , (Link nullAttr [Str "Category:Buddhism and sports"] ("!W",""),
     Link ("", ["backlink-not", "id-not", "link-annotated-not", "link-live"], []) [Str "Category:Buddhism and sports"] ("https://en.wikipedia.org/wiki/Category:Buddhism_and_sports", ""))
    , (Link nullAttr [Str "Buddhism category"] ("!W","Category:Buddhism and sports"),
     Link ("", ["backlink-not", "id-not", "link-annotated-not", "link-live"], []) [Str "Buddhism category"] ("https://en.wikipedia.org/wiki/Category:Buddhism_and_sports", ""))

    -- Should **not** popup at all: [Special:Random](!W)
  , (Link nullAttr [Str "Special:Random"] ("!W",""),
      Link ("", ["backlink-not", "id-not", "link-annotated-not", "link-live-not"], []) [Str "Special:Random"] ("https://en.wikipedia.org/wiki/Special:Random", ""))
  , (Link nullAttr [Str "Special:BookSources/0-8054-2836-4"] ("!W",""),
     Link ("", ["backlink-not", "id-not", "link-annotated-not", "link-live-not"], []) [Str "Special:BookSources/0-8054-2836-4"] ("https://en.wikipedia.org/wiki/Special:BookSources/0-8054-2836-4", ""))
  ]

-- Set link-live/link-live-not and link-annotated/link-annotated-not classes on a WP link depending on its namespace. As the quality of WP API annotations, and the possibility of iframe popups, varies across WP namespaces, we can't simply set them universally.
--
-- A WP link may be to non-article sets of pages, or namespaces (https://en.wikipedia.org/wiki/Wikipedia:Namespace): `Talk`, `User`, `File`, `Wikipedia` etc. eg. 'https://en.wikipedia.org/wiki/File:Energy_density.svg' . Note that we need to match on the colon separator, we can't just match the namespace prefix, because the prefixes are not unique without it, eg. 'https://en.wikipedia.org/wiki/Image_segmentation' is *not* in the `Image` namespace—because images have a colon, and so they would be `Image:...`.
-- So just checking for 'en.wikipedia.org/wiki/' prefix is not enough.
--
-- This is important because we can request Articles through the API and display them as a WP popup, but for other namespaces it would be meaningless (what is the contents of [[Special:Random]]? Or [[Special:BookSources/0-123-456-7]]?). These can only be done as live link popups (if at all, we can't for Special:).
wpPopupClasses :: T.Text -> [T.Text]
wpPopupClasses u = nubOrd $ ["backlink-not", "id-not"] ++ case parseURIReference (T.unpack u) of
                        Nothing -> []
                        Just uri -> case uriAuthority uri of
                          Nothing -> []
                          Just authority -> let article = T.pack $ uriPath uri
                                                domain = T.pack $ uriRegName authority
                                            in
                                             if not ("wikipedia.org" `T.isSuffixOf` domain) && "http" `T.isPrefixOf` u then [] else
                                                        let u' = T.takeWhile (/= ':') $ replaceManyT [("/wiki/", "")] article in
                                                          [if u' `elem` apiNamespacesNo then "link-annotated-not" else "link-annotated",
                                                           if u' `elem` linkliveNamespacesNo then "link-live-not" else "link-live"]

-- WP namespaces which are known to not return a useful annotation from the API; Special: does not (eg. Special:Random, or, common in article popups, Special:BookSources for ISBNs) and returns nothing while Category: returns something which is useless (just the category title!), but surprisingly, most others return something useful (eg. even Talk pages like <https:/en.wikipedia.org/api/rest_v1/page/mobile-sections/Talk:Small_caps> do).
-- I have not checked the full list of namespaces carefully so some of the odder namespaces may be bad.
apiNamespacesNo :: [T.Text]
apiNamespacesNo = ["Category", "File", "Special"]

-- A separate question from API annotations is whether a namespace permits live popups, or if it sets X-FRAME headers. Thus far, only Special: appears to block embeddings (probably for security reasons, as there is a lot of MediaWiki functionality gatewayed behind Special: URLs, while the other namespaces should be harder to abuse).
linkliveNamespacesNo :: [T.Text]
linkliveNamespacesNo = ["Special"]

-- nonArticleNamespace :: [T.Text]
-- nonArticleNamespace = ["Talk", "User", "User_talk", "Wikipedia", "Wikipedia_talk", "File", "File_talk", "MediaWiki", "MediaWiki_talk", "Template", "Template_talk", "Help", "Help_talk", "Category", "Category_talk", "Portal", "Portal_talk", "Draft", "Draft_talk", "TimedText", "TimedText_talk", "Module", "Module_talk", "Gadget", "Gadget_talk", "Gadget definition", "Gadget definition_talk", "Special", "Media"]

-- | Large table of constants; this is a mapping from shortcuts to a URL. The URL can be used by
--   appending to it the article name (suitably URL-escaped, of course).
interwikiMap :: M.Map T.Text T.Text
interwikiMap = M.fromList $ wpInterwikiMap ++ customInterwikiMap
wpInterwikiMap, customInterwikiMap :: [(T.Text, T.Text)]
customInterwikiMap = [("Hackage", "https://hackage.haskell.org/package/"),
                      ("Hawiki", "https://wiki.haskell.org/"),
                      ("Hoogle", "https://hoogle.haskell.org/?hoogle="),
                      -- shortcuts
                      ("W", "https://en.wikipedia.org/wiki/"),
                      ("WP", "https://en.wikipedia.org/wiki/")]
wpInterwikiMap = [("Wikipedia", "https://en.wikipedia.org/wiki/"),
                  ("Wikiquote", "https://en.wikiquote.org/wiki/"),
                  ("Wiktionary", "https://en.wiktionary.org/wiki/")]
