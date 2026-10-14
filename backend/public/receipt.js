// Receipt page print button.
const printButton = document.getElementById("print-btn");
if (printButton) {
  printButton.addEventListener("click", () => window.print());
}
