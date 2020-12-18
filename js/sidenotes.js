/* sidenotes.js: standalone JS library for parsing HTML documents with Pandoc-style footnotes and dynamically repositioning them into the left/right margins, when browser windows are wide enough.
Sidenotes (see https://www.gwern.net/Sidenotes ) are superior to footnotes where possible because they enable the reader to immediately look at them without requiring user action to 'go to' or 'pop up' the footnotes; even floating footnotes require effort by the reader.
sidenotes.js is inspired by the Tufte-CSS sidenotes (https://edwardtufte.github.io/tufte-css/#sidenotes), but where Tufte-CSS uses static footnotes inlined into the body of the page (requiring modifications to Pandoc's compilation), which doesn't always work well for particularly long or frequent sidenotes, sidenotes.js will rearrange sidenotes to fit as best as possible, and will respond to window changes.
Particularly long sidenotes are also partially 'collapsed'.
Styling (especially for oversized-sidenotes which must scroll) is done in /static/css/default.css "SIDENOTES" section.

Author: Said Achmiz
2019-03-11
license: MIT (derivative of footnotes.js, which is PD)
*/

/***********/
/* HELPERS */
/***********/

/*  The "target counterpart" is the element associated with the target, i.e.:
    if the URL hash targets a footnote reference, its counterpart is the
    sidenote for that citation; and vice-versa, if the hash targets a sidenote,
    its counterpart is the in-text citation. We want a target counterpart to be
    highlighted along with the target itself; therefore we apply a special
    "targeted" class to the target counterpart.
    */
function updateTargetCounterpart() {
    GWLog("updateTargetCounterpart", "sidenotes.js");

    /*  Clear existing targeting.
        */
    document.querySelectorAll(".targeted").forEach(element => {
        element.classList.remove("targeted");
    });

    /*  Identify new target counterpart, if any.
        */
    var counterpart;
    if (location.hash.match(/#sn[0-9]/)) {
        counterpart = document.querySelector("#fnref" + location.hash.substr(3));
    } else if (location.hash.match(/#fnref[0-9]/) && GW.sidenotes.mediaQueries.viewportWidthBreakpoint.matches == false) {
        counterpart = document.querySelector("#sn" + location.hash.substr(6));
    }
    /*  If a target counterpart exists, mark it as such.
        */
    if (counterpart)
        counterpart.classList.toggle("targeted", true);
}

/*  This is necessary to defeat a bug where if the page is loaded with the URL
    hash targeting some element, the element does not match the :target CSS
    pseudo-class.
    */
function realignHashIfNeeded() {
    GWLog("realignHashIfNeeded", "sidenotes.js");

    if (location.hash.match(/#sn[0-9]/) || location.hash.match(/#fnref[0-9]/))
        realignHash();
}
function realignHash() {
    GWLog("realignHash", "sidenotes.js");

    var hash = location.hash;
    history.replaceState(null, null, "#");
    location.hash = hash;
}

/*  Make sure clicking a sidenote does not cause scrolling.
    */
function setHashWithoutScrolling(newHash) {
    var selectedRange;
    if (GW.isFirefox)
        selectedRange = window.getSelection().getRangeAt(0);

    let scrollPositionBeforeNavigate = window.scrollY;
    location.hash = newHash;
    requestAnimationFrame(() => {
        window.scrollTo(0, scrollPositionBeforeNavigate);
    });

    if (GW.isFirefox)
        window.getSelection().addRange(selectedRange);
}

/*******************/
/* COLLAPSE BLOCKS */
/*******************/

/*  Returns true if the given collapse block is currently collapsed.
    NOTE: This does not count targeted collapse blocks as expanded unless
    their disclosure button is also engaged (i.e., in the checked state).
    This is deliberate! (Because we use the disclosure button state to
    determine whether we need to recompute layout.)
    */
function isCollapsed(collapseBlock) {
    let collapseCheckbox = collapseBlock.querySelector(".disclosure-button");
    return (collapseCheckbox.checked == false);
}

/*  Returns true if the given element is within a currently-collapsed collapse
    block.
    */
function isWithinCollapsedBlock(element) {
    /*  If the element is not within a collapse block at all, it obviously can't
        be within a *currently-collapsed* collapse block.
        */
    let collapseParent = element.closest(".collapse");
    if (!collapseParent) return false;

    /*  If the element is within a collapse block and that collapse block is
        currently collapsed, then the condition is satisfied...
        */
    if (isCollapsed(collapseParent)) return true;

    /*  BUT the collapse block that the element is in, even if *it* is not
        itself collapsed, could be *within* another collapse block!
        */
    return isWithinCollapsedBlock(collapseParent.parentElement);
}

/*  This function expands all collapse blocks containing the given element, if
    any (including the element itself, if it is a collapse block). Returns true
    if any such expansion occurred.
    */
function expandCollapseBlocksToReveal(element) {
    GWLog("expandCollapseBlocksToReveal", "sidenotes.js");

    /*  If the given element is not within any collapse block, there is nothing
        to do.
        */
    if (!isWithinCollapsedBlock(element)) return false;

    //  Expand the nearest collapse block.
    let collapseParent = element.closest(".collapse");
    let disclosureButton = collapseParent.querySelector(".disclosure-button");
    let expansionOccurred = (disclosureButton.checked == false);
    disclosureButton.checked = true;
    collapseParent.classList.toggle("expanded", disclosureButton.checked);

    //  Expand any higher-level collapse blocks!
    /*  Update sidenote positions only if we do NOT have to do any further
        expansion (otherwise we'll do redundant layout).
        */
    if (!expandCollapseBlocksToReveal(collapseParent.parentElement) && expansionOccurred)
        setTimeout(updateSidenotePositions);

    //  Report whether we had to expand a collapse block.
    return expansionOccurred;
}

/*  This function expands all necessary collapse blocks to reveal the element
    targeted by the URL hash. (This includes expanding collapse blocks to
    reveal a footnote reference associated with a targeted sidenote). It also
    scrolls the targeted element into view.
    */
function revealTarget() {
    GWLog("revealTarget", "sidenotes.js");

    if (!location.hash) return;

    let target = document.querySelector(decodeURIComponent(location.hash));
    if (!target) return;

    /*  What needs to be revealed is not necessarily the targeted element
        itself; if the target is a sidenote, expand collapsed blocks to reveal
        the citation reference.
        */
    let targetInText = location.hash.match(/#sn[0-9]/) ?
                       document.querySelector("#fnref" + location.hash.substr(3)) :
                       target;
    expandCollapseBlocksToReveal(targetInText);

    //  Scroll the target into view.
    target.scrollIntoView();
}

/*  Move sidenotes within currently-collapsed collapse blocks to the hidden
    sidenote storage container (#hidden-sidenote-storage). Conversely, move
    sidenotes within currently-expanded collapse blocks from the hidden sidenote
    storage container to the appropriate sidenote column.
    */
function updateSidenotesInCollapseBlocks() {
    GWLog("updateSidenotesInCollapseBlocks", "sidenotes.js");

    for (var i = 0; i < GW.sidenotes.footnoteRefs.length; i++) {
        let fnref = GW.sidenotes.footnoteRefs[i];
        let sidenote = GW.sidenotes.sidenoteDivs[i];

        //  If the enclosing collapse block is currently collapsed...
        if (isWithinCollapsedBlock(fnref)) {
            //  Move the sidenote to the hidden sidenote storage.
            GW.sidenotes.hiddenSidenoteStorage.appendChild(sidenote);
            continue;
        }

        //  Otherwise, move the sidenote back into the correct sidenote column.
        let side = (i % 2) ? GW.sidenotes.sidenoteColumnLeft : GW.sidenotes.sidenoteColumnRight;
        //  What's the next sidenote?
        var nextSidenoteIndex = i + 2;
        while (nextSidenoteIndex < GW.sidenotes.footnoteRefs.length &&
               GW.sidenotes.sidenoteDivs[nextSidenoteIndex].parentElement == GW.sidenotes.hiddenSidenoteStorage)
               nextSidenoteIndex += 2;
        if (nextSidenoteIndex >= GW.sidenotes.footnoteRefs.length) {
        /*  If no subsequent sidenote is displayed, append the current sidenote
            to the column.
            */
            side.appendChild(sidenote);
        } else {
        /*  Otherwise, insert it before the next displayed sidenote.
            */
            side.insertBefore(sidenote, GW.sidenotes.sidenoteDivs[nextSidenoteIndex]);
        }
    }
}

/***************************/
/* FOOTNOTES VS. SIDENOTES */
/***************************/

/*  In footnote mode (i.e., on viewports too narrow to support sidenotes),
    footnote reference links (i.e., citations) should point down to footnotes.
    But in sidenote mode, footnote reference links should point to sidenotes.
    This function rewrites all footnote reference links appropriately to the
    current mode (based on viewport width).
    */
function updateFootnoteReferenceLinks() {
    GWLog("updateFootnoteReferenceLinks", "sidenotes.js");

    for (var i = 0; i < GW.sidenotes.footnoteRefs.length; i++) {
        let fnref = GW.sidenotes.footnoteRefs[i];
        if (GW.sidenotes.mediaQueries.viewportWidthBreakpoint.matches == false) {
            fnref.href = "#sn" + (i + 1);
        } else {
            fnref.href = "#fn" + (i + 1);
        }
    }
}

/*  Bind event listeners for the footnote popups or the sidenotes, as
    appropriate for the current viewport width; unbind the others.
    */
function updateEventListeners() {
    GWLog("updateEventListeners", "sidenotes.js");

    //  Unbind sidenote mouse events.
	unbindSidenoteMouseEvents();

    //  Determine whether we are in sidenote mode or footnote mode.
    if (!GW.sidenotes.mediaQueries.viewportWidthBreakpoint.matches) {
        //  If we are in sidenotes mode, bind sidenote mouse events.
		bindSidenoteMouseEvents();
    }
}

/*	Bind event listeners for mousing over citations and sidenotes.
	*/
function bindSidenoteMouseEvents() {
    GWLog("bindSidenoteMouseEvents", "sidenotes.js");

	for (var i = 0; i < GW.sidenotes.footnoteRefs.length; i++) {
		let fnref = GW.sidenotes.footnoteRefs[i];
		let sidenote = GW.sidenotes.sidenoteDivs[i];

		fnref.addEventListener("mouseover", fnref.footnoteover = (event) => {
			sidenote.classList.toggle("highlighted", true);
		});
		fnref.addEventListener("mouseout", fnref.footnoteout = (event) => {
			sidenote.classList.remove("highlighted");
		});
		sidenote.addEventListener("mouseover", sidenote.sidenoteover = (event) => {
			fnref.classList.toggle("highlighted", true);
		});
		sidenote.addEventListener("mouseout", sidenote.sidenoteout = (event) => {
			fnref.classList.remove("highlighted");
		});
	}
}

/*	Unbind event listeners for mousing over citations and sidenotes.
	*/
function unbindSidenoteMouseEvents() {
    GWLog("unbindSidenoteMouseEvents", "sidenotes.js");

	for (var i = 0; i < GW.sidenotes.footnoteRefs.length; i++) {
		let fnref = GW.sidenotes.footnoteRefs[i];
		let sidenote = GW.sidenotes.sidenoteDivs[i];

		fnref.removeEventListener("mouseover", fnref.footnoteover);
		fnref.footnoteover = null;

		fnref.removeEventListener("mouseout", fnref.footnoteout);
		fnref.footnoteout = null;

		sidenote.removeEventListener("mouseover", sidenote.sidenoteover);
		sidenote.sidenoteover = null;

		sidenote.removeEventListener("mouseout", sidenote.sidenoteout);
		sidenote.sidenoteout = null;
	}
}

/**********/
/* LAYOUT */
/**********/

/*  This function actually calculates and sets the positions of all sidenotes.
    */
function updateSidenotePositions() {
    GWLog("updateSidenotePositions", "sidenotes.js");

    /*  If we’re in footnotes mode (i.e., the viewport is too narrow), then
        don’t do anything.
        */
    if (GW.sidenotes.mediaQueries.viewportWidthBreakpoint.matches)
        return;

    /*  Position left sidenote column so top is flush with top of first
        full-width block (i.e., one that is not pushed right by the TOC).

        NOTE: This doesn’t quite do what it says (due to overflow), but that’s
        fine; nothing really breaks as a result...
        */
    let markdownBody = document.querySelector("#markdownBody");
    var firstFullWidthBlock;
    for (var block of markdownBody.children) {
        if (block.clientWidth == markdownBody.clientWidth) {
            firstFullWidthBlock = block;
            break;
        }
    }
    let offset = firstFullWidthBlock.offsetTop || 0;
    if (GW.sidenotes.sidenoteColumnLeft.offsetTop < firstFullWidthBlock.offsetTop) {
        GW.sidenotes.sidenoteColumnLeft.style.top = offset + "px";
        GW.sidenotes.sidenoteColumnLeft.style.height = `calc(100% - ${offset}px)`;
    }

    //  Update the disposition of sidenotes within collapse blocks.
    updateSidenotesInCollapseBlocks();

    /*  Initial layout (to force browser layout engine to compute sidenotes’
        height for us).
        */
    for (var i = 0; i < GW.sidenotes.footnoteRefs.length; i++) {
        let sidenote = GW.sidenotes.sidenoteDivs[i];

        /*  Check whether the sidenote is in the hidden sidenote storage (i.e.,
            within a currently-collapsed collapse block. If so, skip it.
            */
        if (sidenote.parentElement == GW.sidenotes.hiddenSidenoteStorage)
            continue;

        //  What side is this sidenote on?
        let side = (i % 2) ? GW.sidenotes.sidenoteColumnLeft : GW.sidenotes.sidenoteColumnRight;

        //  Default position (vertically aligned with the footnote reference).
        sidenote.style.top = Math.round(((GW.sidenotes.footnoteRefs[i].getBoundingClientRect().top) - side.getBoundingClientRect().top) + 4) + "px";

        /*  Mark sidenotes which are cut off vertically.
            */
        let sidenoteOuterWrapper = sidenote.firstElementChild;
        sidenote.classList.toggle("cut-off", (sidenoteOuterWrapper.scrollHeight > sidenoteOuterWrapper.clientHeight + 2));
    }

    /*  Determine proscribed vertical ranges (i.e., bands of the page from which
        sidenotes are excluded, by the presence of, e.g., a full-width table).
        */
    var proscribedVerticalRanges = [ ];
    let rightColumnBoundingRect = GW.sidenotes.sidenoteColumnRight.getBoundingClientRect();
    /*  Examine all potentially overlapping elements (i.e., non-sidenote
        elements that may appear in, or extend into, the side columns).
        */
    GW.sidenotes.potentiallyOverlappingElementsSelector = ".marginnote, .tableWrapper.full-width, figure.full-width";
    document.querySelectorAll(GW.sidenotes.potentiallyOverlappingElementsSelector).forEach(potentiallyOverlappingElement => {
        let elementBoundingRect = potentiallyOverlappingElement.getBoundingClientRect();
        proscribedVerticalRanges.push({ top: elementBoundingRect.top - rightColumnBoundingRect.top,
                                        bottom: elementBoundingRect.bottom - rightColumnBoundingRect.top });
    });
    /*  The bottom of the right column is also a "proscribed vertical range".
        */
    proscribedVerticalRanges.push({
        top:    GW.sidenotes.sidenoteColumnRight.clientHeight,
        bottom: GW.sidenotes.sidenoteColumnRight.clientHeight
    });

    /*  Correct for overlap (both between sidenotes, and of sidenotes with
        proscribed vertical ranges, such as those associated with full-width
        tables).
        */
    for (var i = 0; i < GW.sidenotes.footnoteRefs.length; i++) {
        let sidenote = GW.sidenotes.sidenoteDivs[i];
        let nextSidenote = sidenote.nextElementSibling;

        /*  Is this sidenote even displayed? Or is it hidden (i.e., within
            a currently-collapsed collapse block)? If so, skip it.
            */
        if (sidenote.parentElement == GW.sidenotes.hiddenSidenoteStorage) continue;

        //  What side is this sidenote on?
        let side = (i % 2) ? GW.sidenotes.sidenoteColumnLeft : GW.sidenotes.sidenoteColumnRight;

        /*  What points bound the vertical region within which this sidenote may
            be placed?
            */
        let room = {
            ceiling:    0,
            floor:      side.clientHeight
        };
        let sidenoteFootprint = {
            top:    sidenote.offsetTop - GW.sidenotes.sidenoteSpacing,
            bottom: sidenote.offsetTop + sidenote.clientHeight + GW.sidenotes.sidenoteSpacing
        };
        let sidenoteFootprintHalfwayPoint = (sidenoteFootprint.top + sidenoteFootprint.bottom) / 2;
        /*  Simultaneously traverse the array of proscribed ranges up and down,
            narrowing down the room we have to work with (in which to place this
            sidenote) from both sides.
            */
        var nextProscribedRangeAfterSidenote = -1;
        for (var j = 0; j < proscribedVerticalRanges.length; j++) {
            let rangeCountingUp = {
                top:            proscribedVerticalRanges[j].top - side.offsetTop,
                bottom:         proscribedVerticalRanges[j].bottom - side.offsetTop,
            };
            rangeCountingUp.halfwayPoint = (rangeCountingUp.top + rangeCountingUp.bottom) / 2;
            if (rangeCountingUp.halfwayPoint < sidenoteFootprintHalfwayPoint)
                room.ceiling = rangeCountingUp.bottom;

            let indexCountingDown = proscribedVerticalRanges.length - j - 1;
            let rangeCountingDown = {
                top:    proscribedVerticalRanges[indexCountingDown].top - side.offsetTop,
                bottom: proscribedVerticalRanges[indexCountingDown].bottom - side.offsetTop
            };
            rangeCountingDown.halfwayPoint = (rangeCountingDown.top + rangeCountingDown.bottom) / 2;
            if (rangeCountingDown.halfwayPoint > sidenoteFootprintHalfwayPoint) {
                room.floor = rangeCountingDown.top;
                nextProscribedRangeAfterSidenote = indexCountingDown;
            }
        }
        GWLog(`Sidenote ${i + 1}’s room is: (${room.ceiling}, ${room.floor}).`, "sidenotes.js", 2);

        //  Is this sidenote capable of fitting within the room it now occupies?
        if (sidenoteFootprint.bottom - sidenoteFootprint.top > room.floor - room.ceiling) {
            /*  If this is not caused by bumping into the top of a proscribed
                range, then it could only be because the sidenote is either too
                long for the entire page itself, or it’s longer than the entire
                footnotes section (and comes very late in the document).
                In that case, just give up.
                */
            if (nextProscribedRangeAfterSidenote == -1) {
                GWLog("TOO MUCH SIDENOTES. GIVING UP. :(", "sidenotes.js");
                return;
            }

            /*  Otherwise, move the sidenote down to the next free space, and
                try laying it out again.
                */
            sidenote.style.top = (proscribedVerticalRanges[nextProscribedRangeAfterSidenote].bottom + GW.sidenotes.sidenoteSpacing) + "px";
            i--;
            continue;
        }
        /*  At this point, we are guaranteed that the sidenote can fit within
            its room. We do not have to worry that it will overlap its floor if
            we move it right up against its ceiling (or vice versa).
            */

        /*  Does this sidenote overlap its room’s ceiling? In such a case, we
            will have to move it down, regardless of whether there’s a next
            sidenote that would be overlapped.
            */
        var overlapWithCeiling = room.ceiling - sidenoteFootprint.top;
        if (overlapWithCeiling > 0) {
            GWLog(`Sidenote ${sidenote.id.substr(2)} overlaps its ceiling!`, "sidenotes.js", 2);

            sidenote.style.top = (parseInt(sidenote.style.top) + overlapWithCeiling) + "px";
            sidenoteFootprint.top += overlapWithCeiling;
            sidenoteFootprint.bottom += overlapWithCeiling;
        }

        //  Does this sidenote overlap its room’s floor?
        var overlapWithFloor = sidenoteFootprint.bottom - room.floor;
        if (overlapWithFloor > 0)
            GWLog(`Sidenote ${sidenote.id.substr(2)} overlaps its floor!`, "sidenotes.js", 2);

        /*  Is there a next sidenote, and if so, is there any overlap between
            it and this one?
            */
        var overlapWithNextSidenote = nextSidenote ?
                                      (sidenoteFootprint.bottom - nextSidenote.offsetTop) :
                                      -1;
        if (overlapWithNextSidenote > 0)
            GWLog(`Sidenote ${sidenote.id.substr(2)} overlaps sidenote ${nextSidenote.id.substr(2)}!`, "sidenotes.js", 2);

        /*  If the sidenote overlaps the next sidenote AND its room’s floor,
            we want to know what it overlaps more.
            */
        var overlapBelow = Math.max(overlapWithNextSidenote, overlapWithFloor);

        /*  If there’s no overlap with the room’s floor, and there’s no overlap
            with the next sidenote (or there is no next sidenote), then the
            current sidenote’s position needs no further adjustment.
            */
        if (overlapBelow <= 0) continue;

        /*  Figure out how much vertical space above we have; if there’s enough
            “headroom”, we can simply move the current sidenote up.
            */
        let previousSidenote = sidenote.previousElementSibling;
        let maxHeadroom = sidenoteFootprint.top - room.ceiling;
        let headroom = previousSidenote ?
                       Math.min(maxHeadroom, (sidenoteFootprint.top - (previousSidenote.offsetTop + previousSidenote.clientHeight))) :
                       maxHeadroom;
        GWLog(`We have ${headroom}px of headroom.`, "sidenotes.js", 2);

        //  If we have enough headroom, simply move the sidenote up.
        if (headroom >= overlapBelow) {
            GWLog(`There is enough headroom. Moving sidenote ${sidenote.id.substr(2)} up.`, "sidenotes.js", 2);
            sidenote.style.top = (parseInt(sidenote.style.top) - overlapBelow) + "px";
            continue;
        } else {
            //  We don’t have enough headroom!
            GWLog(`There is not enough headroom to move sidenote ${sidenote.id.substr(2)} all the way up!`, "sidenotes.js", 2);

            /*  If there’s overlap with the room’s floor, and the headroom is
                insufficient to clear that overlap, then we will have to move
                the current sidenote to the next open space, and try laying it
                out again.
                */
            if (headroom < overlapWithFloor) {
                sidenote.style.top = (proscribedVerticalRanges[nextProscribedRangeAfterSidenote].bottom + GW.sidenotes.sidenoteSpacing) + "px";
                i--;
                continue;
            }

            /*  If the headroom is enough to clear the sidenote’s overlap with
                the room’s floor (if any), then it must be insufficient to clear
                the overlap with the next sidenote. Before we try moving the
                current sidenote up, we check to see whether the *next* sidenote
                will fit in the remaining space of the current room. If not,
                then that next sidenote will need to be moved to the next open
                space, and the current sidenote need not be disturbed...
                */
            if ((sidenoteFootprint.bottom + nextSidenote.clientHeight + GW.sidenotes.sidenoteSpacing - headroom) >
                proscribedVerticalRanges[nextProscribedRangeAfterSidenote].top)
                continue;

            //  Move the sidenote up as much as we can...
            GWLog(`Moving sidenote ${sidenote.id.substr(2)} up by ${headroom} pixels...`, "sidenotes.js", 2);
            sidenote.style.top = (parseInt(sidenote.style.top) - headroom) + "px";
            //  Recompute overlap...
            overlapWithNextSidenote -= headroom;
            /*  And move the next sidenote down - possibly causing overlap.
                (But this will be handled when we process the next sidenote.)
                */
            GWLog(`... and moving sidenote ${nextSidenote.id.substr(2)} down by ${overlapWithNextSidenote} pixels.`, "sidenotes.js", 2);
            nextSidenote.style.top = (parseInt(nextSidenote.style.top) + overlapWithNextSidenote) + "px";
        }
    }

    //  Show the sidenote columns.
    GW.sidenotes.sidenoteColumnLeft.style.visibility = "";
    GW.sidenotes.sidenoteColumnRight.style.visibility = "";
}

/*  Constructs the HTML structure, and associated listeners and auxiliaries,
    of the sidenotes.
    */
function constructSidenotes() {
    GWLog("constructSidenotes", "sidenotes.js");

    /*  Do nothing if sidenotes.js somehow gets run extremely early in the page
        load process.
        */
    let markdownBody = document.querySelector("#markdownBody");
    if (!markdownBody) return;

    /*  Add the sidenote columns (removing them first if they already exist).
        */
    if (GW.sidenotes.sidenoteColumnLeft) GW.sidenotes.sidenoteColumnLeft.remove();
    if (GW.sidenotes.sidenoteColumnRight) GW.sidenotes.sidenoteColumnRight.remove();
    markdownBody.insertAdjacentHTML("beforeend",
        "<div id='sidenote-column-left' class='footnotes' style='visibility:hidden'></div>" +
        "<div id='sidenote-column-right' class='footnotes' style='visibility:hidden'></div>");
    GW.sidenotes.sidenoteColumnLeft = document.querySelector("#sidenote-column-left");
    GW.sidenotes.sidenoteColumnRight = document.querySelector("#sidenote-column-right");

    /*  Create and inject the sidenotes.
        */
    GW.sidenotes.sidenoteDivs = [ ];
    //  The footnote references (citations).
    GW.sidenotes.footnoteRefs = Array.from(document.querySelectorAll("a.footnote-ref"));
    for (var i = 0; i < GW.sidenotes.footnoteRefs.length; i++) {
        //  Create the sidenote outer containing block...
        let sidenote = document.createElement("div");
        sidenote.classList.add("sidenote");
        sidenote.id = "sn" + (i + 1);
        //  Wrap the contents of the footnote in two wrapper divs...
        let referencedFootnote = document.querySelector(GW.sidenotes.footnoteRefs[i].hash);
        sidenote.innerHTML = "<div class='sidenote-outer-wrapper'><div class='sidenote-inner-wrapper'>" +
                             (referencedFootnote ? referencedFootnote.innerHTML : "Loading sidenote contents, please wait…")
                             + "</div></div>";
        //  Add the sidenote to the sidenotes array...
        GW.sidenotes.sidenoteDivs.push(sidenote);
        //  On which side should the sidenote go? Odd - right; even - left.
        let side = (i % 2) ? GW.sidenotes.sidenoteColumnLeft : GW.sidenotes.sidenoteColumnRight;
        //  Inject the sidenote into the page.
        side.appendChild(sidenote);
    }

    /*  Create & inject the sidenote self-links (i.e., boxed sidenote numbers).
        */
    for (var i = 0; i < GW.sidenotes.footnoteRefs.length; i++) {
        let sidenoteSelfLink = document.createElement("a");
        sidenoteSelfLink.classList.add("sidenote-self-link");
        sidenoteSelfLink.href = "#sn" + (i + 1);
        sidenoteSelfLink.textContent = (i + 1);
        GW.sidenotes.sidenoteDivs[i].appendChild(sidenoteSelfLink);
    }

    /*  Create & inject the hidden sidenote storage (for sidenotes within
        currently-collapsed collapse blocks).
        */
    if (GW.sidenotes.hiddenSidenoteStorage) GW.sidenotes.hiddenSidenoteStorage.remove();
    GW.sidenotes.hiddenSidenoteStorage = document.createElement("div");
    GW.sidenotes.hiddenSidenoteStorage.id = "hidden-sidenote-storage";
    GW.sidenotes.hiddenSidenoteStorage.style.display = "none";
    markdownBody.appendChild(GW.sidenotes.hiddenSidenoteStorage);

    /*  Add listeners to target a sidenote when clicked.
        */
    for (var i = 0; i < GW.sidenotes.footnoteRefs.length; i++) {
        let sidenote = GW.sidenotes.sidenoteDivs[i];
        sidenote.addEventListener("click", GW.sidenotes.sidenoteClicked = (event) => {
            GWLog("GW.sidenotes.sidenoteClicked", "sidenotes.js");

            if (decodeURIComponent(location.hash) == sidenote.id || event.target.tagName == "A" || event.target.tagName == "IMG") return;

            //  Preserve hash before changing it.
            if (!(location.hash.startsWith("#sn") || location.hash.startsWith("#fnref")))
                GW.sidenotes.hashBeforeSidenoteWasFocused = location.hash;
            setHashWithoutScrolling(encodeURIComponent(sidenote.id));
        });
    }

    /*  Insert zero-width spaces after problematic characters in sidenotes.
        (This is to mitigate justification/wrapping problems.)
        */
    GW.sidenotes.problematicCharacters = '/=≠';
    GW.sidenotes.sidenoteDivs.forEach(sidenote => {
        sidenote.querySelectorAll("*").forEach(element => {
            if (element.closest(".sourceCode")) return;
            element.childNodes.forEach(node => {
                if (node.childNodes.length > 0) return;
                node.textContent = node.textContent.replace(new RegExp("(\\w[" + GW.sidenotes.problematicCharacters + "])(\\w)", 'g'), "$1\u{200B}$2");
            });
        });
    });

	GW.notificationCenter.fireEvent("Sidenotes.sidenotesDidConstruct");
}

/******************/
/* INITIALIZATION */
/******************/

/*  Q:  Why is this setup function so long and complex?
    A:  In order to properly handle all of the following:

    1.  The two different modes (footnote popups vs. sidenotes)
    2.  The interactions between sidenotes and collapse blocks
    3.  Linking to footnotes/sidenotes
    4.  Loading a URL that links to a footnote/sidenote
    5.  Changes in the viewport width dynamically altering all of the above

    … and, of course, correct layout of the sidenotes, even in tricky cases
    where the citations are densely packed and the sidenotes are long.
    */
function sidenotesSetup() {
    GWLog("sidenotesSetup", "sidenotes.js");

    /*  The `sidenoteSpacing` constant defines the minimum vertical space that
        is permitted between adjacent sidenotes; any less, and they are
        considered to be overlapping.
        */
    GW.sidenotes = {
        sidenoteSpacing: 60
    };

    /*  Create media query objects (for checking and attaching listeners).
        */
    GW.sidenotes.mediaQueries = {
        viewportWidthBreakpoint: matchMedia("(max-width: 1760px)"),
        mobileViewportWidthBreakpoint: matchMedia("(max-width: 650px)"),
        hover: matchMedia("only screen and (hover: hover) and (pointer: fine)")
    };

    /*  Listen for changes to whether the viewport width media query is matched;
        if such a change occurs (i.e., if the viewport becomes, or stops being,
        wide enough to support sidenotes), switch modes from footnote popups to
        sidenotes or vice/versa, as appropriate.
        (This listener may also be fired if the dev tools pane is opened, etc.)
        */
    GW.sidenotes.mediaQueries.viewportWidthBreakpoint.addListener(GW.sidenotes.viewportWidthBreakpointChanged = () => {
        GWLog("GW.sidenotes.viewportWidthBreakpointChanged", "sidenotes.js");

        updateEventListeners();
        updateFootnoteReferenceLinks();
    });

    /*  Construct the sidenotes immediately, and also re-construct them as soon
        as the HTML content is fully loaded (if it isn't already).
        */
    constructSidenotes();
    if (document.readyState == "loading")
        window.addEventListener("DOMContentLoaded", constructSidenotes);

    /*  Add a resize listener so that sidenote positions are recalculated when
        the window is resized.
        */
    window.addEventListener('resize', GW.sidenotes.windowResized = (event) => {
        GWLog("GW.sidenotes.windowResized", "sidenotes.js");

        updateSidenotePositions();
    });
    /*  Lay out the sidenotes as soon as the document is loaded.
    	TODO: should this just be doWhenPageLoaded?
        */
    if (document.readyState == "complete") {
        updateSidenotePositions();
    } else {
        if (document.readyState == "loading") {
            window.addEventListener("DOMContentLoaded", updateSidenotePositions);
        } else {
            updateSidenotePositions();
        }
        window.addEventListener("load", updateSidenotePositions);
    }

    /*  On page load, set the correct mode (footnote popups or sidenotes), and
        rewrite the citation (footnote reference) links to point to footnotes
        or to sidenotes, as appropriate.
        */
    doWhenPageLoaded(() => {
        updateEventListeners();
        updateFootnoteReferenceLinks();
    });

    /*  If the page was loaded with a hash that points to a footnote, but
        sidenotes are enabled (or vice-versa), rewrite the hash in accordance
        with the current mode (this will also cause the page to end up scrolled
        to the appropriate element - footnote or sidenote).
        */
    if (location.hash.match(/#sn[0-9]/) &&
        GW.sidenotes.mediaQueries.viewportWidthBreakpoint.matches == true) {
        location.hash = "#fn" + location.hash.substr(3);
    } else if (location.hash.match(/#fn[0-9]/) &&
        GW.sidenotes.mediaQueries.viewportWidthBreakpoint.matches == false) {
        location.hash = "#sn" + location.hash.substr(3);
    } else {
        /*  Otherwise, make sure that if a sidenote is targeted by the hash, it
            indeed ends up looking highlighted (this defeats a weird bug).
            */
        requestAnimationFrame(realignHashIfNeeded);
    }

    /*  Having updated the hash, now properly highlight everything, if needed,
        and add a listener to update the target counterpart if the hash changes
        later.

        Also, if the hash points to a collapse block, or to an element within a
        collapse block, expand it and all collapse blocks enclosing it.
        */
    window.addEventListener("hashchange", GW.sidenotes.hashChanged = () => {
        GWLog("GW.sidenotes.hashChanged", "sidenotes.js");

        revealTarget();
        updateTargetCounterpart();
    });
    window.addEventListener("load", () => {
        revealTarget();
        updateTargetCounterpart();
    });

    /*  Add event listeners to (asynchronously) recompute sidenote positioning
        when a collapse block is manually collapsed or expanded.
        */
    document.querySelectorAll(".disclosure-button").forEach(collapseCheckbox => {
        collapseCheckbox.addEventListener("change", GW.sidenotes.disclosureButtonValueChanged = (event) => {
            GWLog("GW.sidenotes.disclosureButtonValueChanged", "sidenotes.js");

            setTimeout(updateSidenotePositions);
        });
    });

    //  Prepare for hash reversion.
    /*  Save the hash, if need be (if it does NOT point to a sidenote or a
        footnote reference).
        */
    GW.sidenotes.hashBeforeSidenoteWasFocused = (location.hash.startsWith("#sn") || location.hash.startsWith("#fnref")) ?
                                                "" : location.hash;
    /*  Add event listener to un-focus a sidenote (by resetting the hash) when
        the document is clicked anywhere but a sidenote or a link.
        */
    document.body.addEventListener("click", GW.sidenotes.bodyClicked = (event) => {
        GWLog("GW.sidenotes.bodyClicked", "sidenotes.js");

        if (!(event.target.closest("a") || event.target.closest(".sidenote")) &&
            (location.hash.startsWith("#sn") || location.hash.startsWith("#fnref"))) {
            setHashWithoutScrolling(GW.sidenotes.hashBeforeSidenoteWasFocused);
        }
    });

	GW.notificationCenter.fireEvent("Sidenotes.setupDidComplete");
}

GW.notificationCenter.fireEvent("Sidenotes.didLoad");

//  LET... THERE... BE... SIDENOTES!!!
sidenotesSetup();
