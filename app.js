const stopButtons = [...document.querySelectorAll(".stop-button")];
const resetButtons = [document.querySelector("#maxBet"), document.querySelector("#lever")];
const cabinet = document.querySelector(".cabinet");

function setBonusActive(isActive) {
  cabinet.classList.toggle("is-bonus", isActive);
  cabinet.dataset.bonusState = isActive ? "active" : "off";
}

window.setBonusActive = setBonusActive;

document.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() !== "b" || event.repeat) return;
  setBonusActive(!cabinet.classList.contains("is-bonus"));
});

function resetStopLights() {
  stopButtons.forEach((button) => {
    button.classList.add("is-lit");
    button.classList.remove("is-off");
    button.setAttribute("aria-pressed", "false");
  });
}

stopButtons.forEach((button) => {
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", () => {
    button.classList.remove("is-lit");
    button.classList.add("is-off");
    button.setAttribute("aria-pressed", "true");
  });
});

resetButtons.forEach((button) => button.addEventListener("click", resetStopLights));
