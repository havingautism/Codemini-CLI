function attachThrowingClick(button) {
  button.addEventListener("click", function onThrow() {
    throw new Error("handler blew up");
  });
}

const button = document.getElementById("throws");
if (button) attachThrowingClick(button);
