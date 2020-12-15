/*	Popup/floating footnotes to avoid readers needing to scroll to the end of
	the page to see any footnotes; see
	http://ignorethecode.net/blog/2010/04/20/footnotes/ for details.
Original author:  Lukas Mathis (2010-04-20)
License: public domain ("And some people have asked me about a license for this piece of code. I think it’s far too short to get its own license, so I’m relinquishing any copyright claims. Consider the code to be public domain. No attribution is necessary.")
	*/
Popups = {
	/**********/
	/*	Config.
		*/
    stylesID: "popups-styles",
    popupContainerID: "popup-container",
    popupContainerParentSelector: "html",
    popupContainerZIndex: "1000",

    popupBreathingRoomX: 24.0,
    popupBreathingRoomY: 16.0,

    popupTriggerDelay: 200,
    popupFadeoutDelay: 50,
    popupFadeoutDuration: 250,

	/******************/
	/*	Implementation.
		*/
	popupFadeTimer: false,
	popupDespawnTimer: false,
	popupSpawnTimer: false,
	popupContainer: null,
	popup: null,

	isMobile: () => {
		/*  We consider a client to be mobile if one of two conditions obtain:
		    1. JavaScript detects touch capability, AND viewport is narrow; or,
		    2. CSS does NOT detect hover capability.
		    */
		return (   (   ('ontouchstart' in document.documentElement)
					&& GW.mediaQueries.mobileWidth.matches)
				|| !GW.mediaQueries.hoverAvailable.matches);
	},

	cleanup: () => {
		GWLog("Popups.cleanup", "popups.js", 1);

        //  Remove popups container and injected styles.
        document.querySelectorAll(`#${Popups.stylesID}, #${Popups.popupContainerID}`).forEach(element => element.remove());
	},
	setup: () => {
		GWLog("Popups.setup", "popups.js", 1);

        //  Run cleanup.
        Popups.cleanup();

        //  Inject styles.
        document.querySelector("head").insertAdjacentHTML("beforeend", Popups.stylesHTML);

        //  Inject popups container.
        let popupContainerParent = document.querySelector(Popups.popupContainerParentSelector);
        if (!popupContainerParent) {
            GWLog("Popup container parent element not found. Exiting.", "popups.js", 1);
            return;
        }
        popupContainerParent.insertAdjacentHTML("beforeend", `<div id='${Popups.popupContainerID}' style='z-index: ${Popups.popupContainerZIndex};'></div>`);
        requestAnimationFrame(() => {
            Popups.popupContainer = document.querySelector(`#${Popups.popupContainerID}`);
        });

		GW.notificationCenter.fireEvent("Popups.setupComplete");
	},
	addTargets: (targetSelectors, prepareFunction, targetPrepareFunction = null) => {
		GWLog("Popups.addTargets", "popups.js", 1);

		//	Get all targets.
		document.querySelectorAll(targetSelectors.targetElementsSelector).forEach(target => {
			if (   target.closest(targetSelectors.excludedElementsSelector) == target
				|| target.closest(targetSelectors.excludedContainerElementsSelector) != null)
				return;

			//	Bind mouseenter/mouseleave events.
			target.addEventListener("mouseenter", Popups.targetMouseenter);
			target.addEventListener("mouseleave", Popups.targetMouseleave);

			//  Set prepare function.
			target.popupPrepareFunction = prepareFunction;

			//  Run any custom processing.
			if (targetPrepareFunction)
				targetPrepareFunction(target);
		});
	},
	removeTargets: (targetSelectors) => {
		GWLog("Popups.removeTargets", "popups.js", 1);

		document.querySelectorAll(targetSelectors.targetElementsSelector).forEach(target => {
			if (   target.closest(targetSelectors.excludedElementsSelector) == target
				|| target.closest(targetSelectors.excludedContainerElementsSelector) != null)
				return;

			//	Unbind existing mouseenter/mouseleave events, if any.
			target.removeEventListener("mouseenter", Footnotes.targetMouseenter);
			target.removeEventListener("mouseleave", Footnotes.targetMouseleave);

			//  Unset popup prepare function.
			target.popupPrepareFunction = null;
		});
	},

	newPopup: () => {
		GWLog("Popups.newPopup", "popups.js", 2);

		let popup = document.createElement('div');
		popup.id = 'popupdiv';
		popup.classList.toggle('popupdiv', true);
		return popup;
	},
	spawnPopup: (popup, target, event) => {
		GWLog("Popups.spawnPopup", "popups.js", 2);

		//	Inject the popup into the page.
		Popups.injectPopup(popup);

		//  Position the popup appropriately with respect to the target.
		Popups.positionPopup(popup, target, event);
	},
	injectPopup: (popup) => {
		GWLog("Popups.injectPopup", "popups.js", 2);

		Popups.popupContainer.appendChild(popup);

		//	Add event listeners.
		popup.addEventListener("mouseup", Popups.popupMouseup);
		popup.addEventListener("mouseenter", Popups.popupMouseenter);
		popup.addEventListener("mouseleave", Popups.popupMouseleave);
	},
	positionPopup: (popup, target, event) => {
		GWLog("Popups.positionPopup", "popups.js", 2);

		let popupContainerViewportRect = Popups.popupContainer.getBoundingClientRect();
		let targetViewportRect = target.getBoundingClientRect();
		let targetOriginInPopupContainer = {
			x: (targetViewportRect.left - popupContainerViewportRect.left),
			y: (targetViewportRect.top - popupContainerViewportRect.top)
		};
		let mouseEnterEventPositionInPopupContainer = {
			x: (event.clientX - popupContainerViewportRect.left),
			y: (event.clientY - popupContainerViewportRect.top)
		};

		//  Wait for the "naive" layout to be completed, and then...
		requestAnimationFrame(() => {
			/*  How much "breathing room" to give the target (i.e., offset of
				the popup).
				*/
			var popupBreathingRoom = {
				x: Popups.popupBreathingRoomX,
				y: Popups.popupBreathingRoomY
			};

			/*  This is the width and height of the popup, as already determined
				by the layout system, and taking into account the popup's content,
				and the max-width, min-width, etc., CSS properties.
				*/
			var popupIntrinsicWidth = popup.clientWidth;
			var popupIntrinsicHeight = popup.clientHeight;

			var provisionalPopupXPosition;
			var provisionalPopupYPosition;

			var tocLink = target.closest("#TOC");
			if (tocLink) {
				provisionalPopupXPosition = document.querySelector("#TOC").getBoundingClientRect().right + 1.0 - popupContainerViewportRect.left;
				provisionalPopupYPosition = mouseEnterEventPositionInPopupContainer.y - ((event.clientY / window.innerHeight) * popupIntrinsicHeight);
			} else {
				var offToTheSide = false;

				/*  Can the popup fit above the target? If so, put it there.
					Failing that, can it fit below the target? If so, put it there.
					*/
				var popupSpawnYOriginForSpawnAbove = Math.min(mouseEnterEventPositionInPopupContainer.y - popupBreathingRoom.y,
															  targetOriginInPopupContainer.y + targetViewportRect.height - (popupBreathingRoom.y * 2.0));
				var popupSpawnYOriginForSpawnBelow = Math.max(mouseEnterEventPositionInPopupContainer.y + popupBreathingRoom.y,
															  targetOriginInPopupContainer.y + (popupBreathingRoom.y * 2.0));
				if (  popupSpawnYOriginForSpawnAbove - popupIntrinsicHeight >= popupContainerViewportRect.y * -1) {
					//  Above.
					provisionalPopupYPosition = popupSpawnYOriginForSpawnAbove - popupIntrinsicHeight;
				} else if (popupSpawnYOriginForSpawnBelow + popupIntrinsicHeight <= (popupContainerViewportRect.y * -1) + window.innerHeight) {
					//  Below.
					provisionalPopupYPosition = popupSpawnYOriginForSpawnBelow;
				} else {
					/*  The popup does not fit above or below! We will have to
						put it off to the left or right.
						*/
					offToTheSide = true;
				}

				if (offToTheSide) {
					popupBreathingRoom.x *= 2.0;
					provisionalPopupYPosition = mouseEnterEventPositionInPopupContainer.y - ((event.clientY / window.innerHeight) * popupIntrinsicHeight);
					if (provisionalPopupYPosition - popupContainerViewportRect.y < 0)
						provisionalPopupYPosition = 0.0;

					//  Determine whether to put the popup off to the right, or left.
					if (  mouseEnterEventPositionInPopupContainer.x
						+ popupBreathingRoom.x
						+ popupIntrinsicWidth
						  <=
						  popupContainerViewportRect.x * -1
						+ window.innerWidth) {
						//  Off to the right.
						provisionalPopupXPosition = mouseEnterEventPositionInPopupContainer.x + popupBreathingRoom.x;
					} else if (  mouseEnterEventPositionInPopupContainer.x
							   - popupBreathingRoom.x
							   - popupIntrinsicWidth
								 >=
								 popupContainerViewportRect.x * -1) {
						//  Off to the left.
						provisionalPopupXPosition = mouseEnterEventPositionInPopupContainer.x - popupIntrinsicWidth - popupBreathingRoom.x;
					}
				} else {
					/*  Place popup off to the right (and either above or below),
						as per the previous block of code.
						*/
					provisionalPopupXPosition = mouseEnterEventPositionInPopupContainer.x + popupBreathingRoom.x;
				}
			}

			/*  Does the popup extend past the right edge of the container?
				If so, move it left, until its right edge is flush with
				the container's right edge.
				*/
			if (provisionalPopupXPosition + popupIntrinsicWidth > popupContainerViewportRect.width) {
				provisionalPopupXPosition -= provisionalPopupXPosition + popupIntrinsicWidth - popupContainerViewportRect.width;
			}

			/*  Now (after having nudged the popup left, if need be),
				does the popup extend past the *left* edge of the container?
				Make its left edge flush with the container's left edge.
				*/
			if (provisionalPopupXPosition < 0) {
				provisionalPopupXPosition = 0;
			}

			popup.style.left = `${provisionalPopupXPosition}px`;
			popup.style.top = `${provisionalPopupYPosition}px`;

			document.activeElement.blur();
		});
	},
    despawnPopup: (popup) => {
		GWLog("Popups.despawnPopup", "popups.js", 2);

		if (popup == null)
			return;

	    popup.classList.remove("fading");
        popup.remove();
        document.activeElement.blur();
    },

    clearPopupTimers: () => {
	    GWLog("Popups.clearPopupTimers", "popups.js", 2);

		if (Popups.popup)
			Popups.popup.classList.remove("fading");

        clearTimeout(Popups.popupFadeTimer);
        clearTimeout(Popups.popupDespawnTimer);
        clearTimeout(Popups.popupSpawnTimer);
    },
	setPopupSpawnTimer: (target, event, prepareFunction) => {
		GWLog("Popups.setPopupSpawnTimer", "popups.js", 2);

		Popups.popupSpawnTimer = setTimeout(() => {
			GWLog("Popups.popupSpawnTimer fired", "popups.js", 2);

			//  Despawn existing popup, if any.
			Popups.despawnPopup(Popups.popup);

			//  Create the new popup.
			Popups.popup = Popups.newPopup();

			// Prepare the newly created popup for spawning.
			if (prepareFunction(Popups.popup, target) == false)
				return;

			// Spawn the prepared popup.
			Popups.spawnPopup(Popups.popup, target, event);
		}, Popups.popupTriggerDelay);
	},
    setPopupFadeTimer: () => {
		GWLog("Popups.setPopupFadeTimer", "popups.js", 2);

        Popups.popupFadeTimer = setTimeout(() => {
			GWLog("Popups.popupFadeTimer fired", "popups.js", 2);

			Popups.setPopupDespawnTimer();
        }, Popups.popupFadeoutDelay);
    },
    setPopupDespawnTimer: () => {
		GWLog("Popups.setPopupDespawnTimer", "popups.js", 2);

		Popups.popup.classList.add("fading");
		Popups.popupDespawnTimer = setTimeout(() => {
			GWLog("Popups.popupDespawnTimer fired", "popups.js", 2);

			Popups.despawnPopup(Popups.popup);
		}, Popups.popupFadeoutDuration);
    },

    //	The “user moved mouse out of popup” mouseleave event.
	popupMouseleave: (event) => {
		GWLog("Popups.popupMouseleave", "popups.js", 2);

		Popups.clearPopupTimers();
		Popups.setPopupFadeTimer();
	},
	//	The “user moved mouse back into popup” mouseenter event.
	popupMouseenter: (event) => {
		GWLog("Popups.popupMouseenter", "popups.js", 2);

		Popups.clearPopupTimers();
	},
    popupMouseup: (event) => {
		GWLog("Popups.popupMouseup", "popups.js", 2);

		event.stopPropagation();
		Popups.despawnPopup(Popups.popup);

		Popups.clearPopupTimers();
    },
	//	The mouseenter event.
	targetMouseenter: (event) => {
		GWLog("Popups.targetMouseenter", "popups.js", 2);

		//	Stop the countdown to un-pop the popup.
		Popups.clearPopupTimers();

		//  Start the countdown to pop up the popup.
		Popups.setPopupSpawnTimer(event.target, event, event.target.popupPrepareFunction);
	},
	//	The mouseleave event.
	targetMouseleave: (event) => {
		GWLog("Popups.targetMouseleave", "popups.js", 2);

		Popups.clearPopupTimers();

		if (Popups.popup)
			Popups.setPopupFadeTimer();
	}
};

/********************/
/*	Essential styles.
	*/
Popups.stylesHTML = `<style id='${Popups.stylesID}'>
#${Popups.popupContainerID} {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    pointer-events: none;
}
#${Popups.popupContainerID} > * {
    pointer-events: auto;
}
.popupdiv {
    position: absolute;
    opacity: 1.0;
    transition: none;
}
.popupdiv.fading {
    opacity: 0.0;
    transition:
        opacity 0.25s ease-in 0.1s;
}
.popupdiv > div {
    overflow: auto;
    overscroll-behavior: none;
}
</style>`;

/******************/
/*	Initialization.
	*/
doWhenPageLoaded(() => {
	GW.notificationCenter.fireEvent("Popups.loaded");

	Popups.setup();
});
