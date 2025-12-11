const roomName = document.getElementById("roomName").value;
const userRole = document.getElementById("userRole").value;

const socket = io({ withCredentials: true });

// ==== ELEMENTS ====
const closeRoomBtn = document.getElementById("close-room-btn");
const startQuizBtn = document.getElementById("start-quiz-btn");
const passwordPrompt = document.getElementById("password-prompt");
const passwordInput = document.getElementById("password-input");
const joinRoomBtn = document.getElementById("join-room-btn");
const container = document.getElementById("container");

const chatBox = document.getElementById("chat-box");
const userListContainer = document.getElementById("user-list");
const form = document.getElementById("chat-form");
const input = document.getElementById("msg");

const mainQuiz = document.getElementById("main-quiz");
const quizInfo = document.getElementById("quiz-info");
const questionContainer = document.getElementById("question-container");
const answersContainer = document.getElementById("answers-container");
const submitAnswerBtn = document.getElementById("submit-answer");
const quizNotification = document.getElementById("quiz-notification");

const correctionPanel = document.getElementById("correction-panel");
const correctionQuestion = document.getElementById("correction-question");
const correctionUserAnswers = document.getElementById("correction-user-answers");
const prevCorrectionBtn = document.getElementById("prev-correction-btn");
const nextCorrectionBtn = document.getElementById("next-correction-btn");
const correctionStatus = document.getElementById("correction-status");

const finalRanking = document.getElementById("final-ranking");
const rankingTableBody = document.querySelector("#ranking-table tbody");

// ==== VARIABLES ====
let quizQuestions = [];
let currentQuestionIndex = 0;
let userAnswers = [];
let canAnswer = true;
let questionTimer, questionInterval;

// ==== POPUP ====
function showPopup(msg){
    const p = document.createElement("div");
    p.className = "popup";
    p.textContent = msg;
    document.body.appendChild(p);
    setTimeout(()=>p.remove(),3500);
}

// ==== JOIN ROOM ====
function joinRoom(password){
    socket.emit("joinRoom", {room: roomName, password});
}

joinRoomBtn.addEventListener("click", () => {
    const pwd = passwordInput.value.trim();
    if(!pwd) return showPopup("Veuillez entrer un mot de passe.");
    joinRoom(pwd);
});

passwordInput.addEventListener("keydown", e => {
    if(e.key === "Enter") joinRoomBtn.click();
});

// ==== ADMIN CONTROLS ====
function showAdminControls(){
    if(userRole === "admin"){
        closeRoomBtn.style.display = "inline-block";
        startQuizBtn.style.display = "inline-block";
    }
}

startQuizBtn.addEventListener("click", () => {
    socket.emit("startQuiz");
    startQuizBtn.style.display = "none";
});

// Fermer la room à tout moment
closeRoomBtn.addEventListener("click", () => {
    socket.emit("closeRoom", roomName);
});

socket.on("roomClosed", (msg) => {
    showPopup(msg || "La room a été fermée par l'admin");
    container.style.display = "none";
    mainQuiz.style.display = "none";
    chatBox.style.display = "none";
    userListContainer.style.display = "none";
    form.style.display = "none";
    closeRoomBtn.style.display = "none";
    startQuizBtn.style.display = "none";

    setTimeout(() => window.location.href = "/", 1500);
});

// ==== CHAT ====
socket.on("chatHistory", messages => {
    passwordPrompt.style.display = "none";
    container.style.display = "flex";
    chatBox.style.display = "block";
    userListContainer.style.display = "block";
    form.style.display = "flex";

    chatBox.innerHTML = "";
    messages.forEach(msg => {
        const p = document.createElement("p");
        const time = msg.createdAt ? `[${new Date(msg.createdAt).toLocaleTimeString()}] ` : "";
        p.textContent = `${time}${msg.user||'Anonyme'}: ${msg.message}`;
        chatBox.appendChild(p);
    });
    chatBox.scrollTop = chatBox.scrollHeight;
    showAdminControls();
});

socket.on("chatMessage", data => {
    const p = document.createElement("p");
    const time = data.createdAt ? `[${new Date(data.createdAt).toLocaleTimeString()}] ` : "";
    p.textContent = `${time}${data.user||'Anonyme'}: ${data.message}`;
    chatBox.appendChild(p);
    chatBox.scrollTop = chatBox.scrollHeight;
});

socket.on("userList", users => {
    if(users.length === 0){
        userListContainer.textContent = "Aucun utilisateur dans la room.";
        return;
    }
    userListContainer.innerHTML = users.map(u => `<span><img src="/${u.avatar}" width="30" height="30" style="border-radius:50%"> <strong>${u.username}</strong></span>`).join(", ");
});

form.addEventListener("submit", e => {
    e.preventDefault();
    const message = input.value.trim();
    if(!message) return;
    socket.emit("sendMessage", {room: roomName, message});
    input.value = "";
});

input.addEventListener("input", () => socket.emit("typing", roomName));