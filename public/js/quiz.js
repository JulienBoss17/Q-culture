// ==== UTILS ====
function showPopup(msg){
    const p = document.createElement("div");
    p.className = "popup";
    p.textContent = msg;
    document.body.appendChild(p);
    setTimeout(()=>p.remove(),3500);
}

// ==== VARIABLES GLOBALES ====
let timerInterval = null;

// Pour correction
let correctionData = null;
let currentCorrectionIndex = 0;
let playerScores = {}; 

// ==== RENDER QUESTION ====
function renderQuestion(qIndex){
    const q = quizQuestions[qIndex];
    if(!q) return;

    canAnswer = true;
    currentQuestionIndex = qIndex;
    quizInfo.textContent = `Question ${qIndex+1}/${quizQuestions.length}`;
    questionContainer.innerHTML = "";
    answersContainer.innerHTML = "";
    submitAnswerBtn.disabled = true;
    submitAnswerBtn.dataset.selectedIndex = null;
    quizNotification.textContent = "";
    document.getElementById("question-timer").textContent = "";

    const p = document.createElement("p");
    p.textContent = q.text || "Question sans texte";
    questionContainer.appendChild(p);

    if(Array.isArray(q.media)){
        q.media.forEach(m => {
            let elem;
            if(m.type==="image"){ elem=document.createElement("img"); elem.src=m.url; }
            if(m.type==="audio"){ elem=document.createElement("audio"); elem.src=m.url; elem.controls=true; }
            if(m.type==="video"){ elem=document.createElement("video"); elem.src=m.url; elem.controls=true; }
            if(elem){ elem.style.marginBottom="15px"; questionContainer.appendChild(elem); }
        });
    }

    q.answers.forEach((a,i)=>{
        const btn = document.createElement("button");
        btn.textContent = a;
        btn.className = "answer-btn";
        btn.addEventListener("click", ()=>{
            if(!canAnswer) return;
            answersContainer.querySelectorAll("button").forEach(b=>b.classList.remove("selected"));
            btn.classList.add("selected");
            submitAnswerBtn.disabled = false;
            submitAnswerBtn.dataset.selectedIndex = i;
        });
        answersContainer.appendChild(btn);
    });
}

// ==== TIMER CLIENT ====
function launchTimer(endTime){
    if(timerInterval) clearInterval(timerInterval);
    const timerDisplay = document.getElementById("question-timer");

    function updateTimer(){
        const remaining = Math.max(0, Math.ceil((endTime - Date.now())/1000));
        timerDisplay.textContent = `Temps restant: ${remaining}s`;

        if(remaining <= 0){
            clearInterval(timerInterval);
            canAnswer = false;
            submitAnswerBtn.disabled = true;

            if(userAnswers[currentQuestionIndex] === null){
                socket.emit("submitAnswer", { qIndex: currentQuestionIndex, answerIndex: null });
            }
        }
    }

    updateTimer();
    timerInterval = setInterval(updateTimer, 500);
}

// ==== QUIZ START ====
socket.on("startQuiz", ({ questions, endTime }) => {
    if(!questions || !questions.length) return showPopup("Aucune question disponible.");

    quizQuestions = questions;
    currentQuestionIndex = 0;
    userAnswers = new Array(quizQuestions.length).fill(null);

    document.getElementById("lobby").style.display = "none";
    mainQuiz.style.display = "flex";
    correctionPanel.style.display = "none";

    renderQuestion(0);
    if(endTime) launchTimer(endTime);
});

// ==== SUBMIT ANSWER ====
submitAnswerBtn.addEventListener("click", ()=>{
    if(!canAnswer) return;
    const idx = Number(submitAnswerBtn.dataset.selectedIndex);
    socket.emit("submitAnswer", { qIndex: currentQuestionIndex, answerIndex: idx });
    userAnswers[currentQuestionIndex] = idx;
    submitAnswerBtn.disabled = true;
    canAnswer = false;
    quizNotification.textContent = "Réponse envoyée";
});

// ==== NEXT QUESTION ====
socket.on("nextQuestion", ({ qIndex, endTime }) => {
    renderQuestion(qIndex);
    if(endTime) launchTimer(endTime);
});

// ==== CORRECTION ====
function renderCorrectionQuestion(idx){
    if(!correctionData) return;
    const q = correctionData.questions[idx];
    const answers = correctionData.userAnswers;
    const correct = correctionData.correctAnswers;

    correctionQuestion.innerHTML = `Q${idx+1}: ${q.text || "Question sans texte"}`;
    correctionUserAnswers.innerHTML = "";

    // Médias si présents
    if(Array.isArray(q.media)){
        q.media.forEach(m => {
            let elem;
            if(m.type==="image"){ elem=document.createElement("img"); elem.src=m.url; }
            if(m.type==="audio"){ elem=document.createElement("audio"); elem.src=m.url; elem.controls=true; }
            if(m.type==="video"){ elem=document.createElement("video"); elem.src=m.url; elem.controls=true; }
            if(elem){ elem.style.marginBottom="15px"; correctionUserAnswers.appendChild(elem); }
        });
    }

    // Liste des réponses des joueurs
    const ul = document.createElement("ul");
    for(const user in answers){
        const ans = answers[user][idx];
        const li = document.createElement("li");

        if(ans === null){
            li.textContent = `${user}: `;
            li.style.color = "red";
        } else {
            li.textContent = `${user}: ${q.answers[ans]}`;
            li.style.color = ans === correct[idx] ? "green" : "red";

            if(!playerScores[user]) playerScores[user]=0;
            if(ans === correct[idx]) playerScores[user]+=1;
        }
        ul.appendChild(li);
    }
    correctionUserAnswers.appendChild(ul);

    prevCorrectionBtn.disabled = idx===0;
    nextCorrectionBtn.disabled = idx===correctionData.questions.length-1;
    correctionStatus.textContent = `Question ${idx+1} / ${correctionData.questions.length}`;
}

// Boutons navigation
prevCorrectionBtn.addEventListener("click", ()=>{
    if(currentCorrectionIndex>0){
        currentCorrectionIndex--;
        renderCorrectionQuestion(currentCorrectionIndex);
    }
});
nextCorrectionBtn.addEventListener("click", ()=>{
    if(currentCorrectionIndex<correctionData.questions.length-1){
        currentCorrectionIndex++;
        renderCorrectionQuestion(currentCorrectionIndex);
    }
});

// EVENEMENT SOCKET POUR CORRECTION
socket.on("startCorrection", (data)=>{
    correctionData = data;
    mainQuiz.style.display = "none";
    correctionPanel.style.display = "block";
    currentCorrectionIndex=0;
    playerScores={};
    renderCorrectionQuestion(currentCorrectionIndex);

    // Classement final
    rankingTableBody.innerHTML = "";
    const ranking = Object.entries(playerScores)
        .sort((a,b)=>b[1]-a[1])
        .map(([user, score])=>({ user, score }));

    ranking.forEach(r=>{
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${r.user}</td><td>${r.score}</td>`;
        rankingTableBody.appendChild(tr);
    });
    finalRanking.style.display = "block";
});
