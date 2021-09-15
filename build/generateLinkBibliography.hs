#!/usr/bin/env runhaskell
{-# LANGUAGE OverloadedStrings #-}
module Main where

-- Generate "link bibliographies" for Gwern.net pages.
-- Link bibliographies are similar to directory indexes in compiling a list of all links on a Gwern.net page/essay, in order, with their annotations (where available). They are the forward-citation dual of backlinks, are much easier to synoptically browse than mousing over links one at a time, and can help provide a static version of the page (ie download page + link bibliography to preserve the annotations).
--
-- Link bibliographies are generated by parsing each $PAGE (provided in default.html as '$url$'), filtering for Links using the Pandoc API, querying the metadata, generating a numbered list of links, and then writing out the generated Markdown file to 'docs/link-bibliography/$PAGE.page'. They are compiled like normal pages by Hakyll, and they are exposed to readers as an additional link in the page metadata block, paired with the backlinks.

import System.Environment (getArgs)
import Text.Pandoc
-- import Control.Monad.Parallel as Par (mapM_)
import LinkMetadata -- (readLinkMetadata, generateAnnotationBlock, getBackLink, generateID, authorsToCite, Metadata, MetadataItem)
import Data.Text.IO as TIO (readFile)
import qualified Data.Text as T
-- import Text.Pandoc.Walk
import qualified Data.Map as M (lookup)
import System.IO (stderr, hPrint)
import System.IO.Temp (writeSystemTempFile)
import System.Directory (listDirectory, doesFileExist, doesDirectoryExist, renameFile, removeFile)
import Data.List (isPrefixOf, isSuffixOf)
import System.FilePath (takeDirectory, takeFileName)
import Data.List.Utils (replace)

main :: IO ()
main = do pages <- getArgs
          md <- readLinkMetadata
          mapM_ (generateLinkBibliography md) pages

generateLinkBibliography :: Metadata -> String -> IO ()
generateLinkBibliography md page = do links <- extractLinksFromPage page
                                      let pairs = linksToAnnotations md links
                                          body = generateLinkBibliographyItems pairs
                                          document = Pandoc nullMeta [body]
                                          markdown = runPure $ writeMarkdown def{writerExtensions = pandocExtensions} document
                                      case markdown of
                                        Left e   -> hPrint stderr e
                                        -- compare with the old version, and update if there are any differences:
                                        Right p' -> do let contentsNew = (generateYAMLHeader (replace ".page" "" page)) ++ T.unpack p'
                                                       updateFile ("docs/link-bibliography/" ++ page) contentsNew

updateFile :: FilePath -> String -> IO ()
updateFile f contentsNew = do t <- writeSystemTempFile "hakyll-link-bibliography" contentsNew
                              existsOld <- doesFileExist f
                              if not existsOld then
                                renameFile t f
                                else
                                  do contentsOld <- Prelude.readFile f
                                     if contentsNew /= contentsOld then renameFile t f else removeFile t

generateYAMLHeader :: FilePath -> String
generateYAMLHeader d = "---\n" ++
                       "title: " ++ d ++ " (Link Bibliography)\n" ++
                       "description: Annotated bibliography of links in the top-level page " ++ d ++ " \n" ++
                       "tags: index\n" ++
                       "created: 2009-01-01\n" ++
                       "status: in progress\n" ++
                       "confidence: log\n" ++
                       "importance: 0\n" ++
                       "cssExtension: drop-caps-de-zs\n" ++
                       "index: true\n" ++
                       "...\n" ++
                       "\n"

generateLinkBibliographyItems :: [(String,MetadataItem)] -> Block
generateLinkBibliographyItems items = OrderedList (1, DefaultStyle, DefaultDelim) $ map generateLinkBibliographyItem items
generateLinkBibliographyItem  :: (String,MetadataItem) -> [Block]
generateLinkBibliographyItem (f,(t,aut,_,_,_,""))  = let f' = if "http"`isPrefixOf`f then f else if "index" `isSuffixOf` f then takeDirectory f else takeFileName f
                                                         author = if aut=="" then [] else [Str ",", Space, Str (T.pack aut)]
                                                            -- I skip date because files don't usually have anything better than year, and that's already encoded in the filename which is shown
                                        in
                                          if t=="" then
                                            [Para (Link nullAttr [Code nullAttr (T.pack f')] (T.pack f, "") : (author))]
                                          else
                                            [Para (Code nullAttr (T.pack f') : (Link nullAttr [Str ":", Space, Str "“", Str (T.pack t), Str "”"] (T.pack f, "")) : (author))]
generateLinkBibliographyItem (f,a) =
  -- render annotation as: (skipping DOIs)
  --
  -- > [`2010-lucretius-dererumnatura.pdf`: "On The Nature of Things"](/docs/philosophy/2010-lucretius-dererumnatura.pdf), Lucretius (55BC-01-01):
  -- >
  -- > > A poem on the Epicurean model of the world...
  generateAnnotationBlock ("/"`isPrefixOf`f) (f,Just a) ""


extractLinksFromPage :: String -> IO [String]
extractLinksFromPage path = do f <- TIO.readFile path
                               let pE = runPure $ readMarkdown def{readerExtensions=pandocExtensions} f
                               return $ case pE of
                                          Left  _ -> []
                                          Right p -> extractLinks p -- TODO: maybe extract the title from the metadata for nicer formatting?
extractLinks :: Pandoc -> [String]
extractLinks p = queryWith extractLink p
extractLink :: Inline -> [String]
extractLink (Link _ _ (path, _)) = [T.unpack path]
extractLink _ = []

linksToAnnotations :: Metadata -> [String] -> [(String,MetadataItem)]
linksToAnnotations m us = map (linkToAnnotation m) us
linkToAnnotation :: Metadata -> String -> (String,MetadataItem)
linkToAnnotation m u = case M.lookup u m of
                         Just i  -> (u,i)
                         Nothing -> (u,("","","","",[],""))
