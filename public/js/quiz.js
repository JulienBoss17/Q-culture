
// ==== UTILS ====
function showPopup(msg){
    const p = document.createElement("div");
    p.className = "popup";
    p.textContent = msg;
    document.body.appendChild(p);
    setTimeout(()=>p.remove(),3500);
}

// ==== RENDER QUESTION ====
function renderQuestion(){
    const q = quizQuestions[currentQuestionIndex];
    if(!q) return;

    canAnswer = true;
    quizInfo.textContent = `Question ${currentQuestionIndex+1}/${quizQuestions.length}`;
    questionContainer.innerHTML = "";
    answersContainer.innerHTML = "";
    submitAnswerBtn.disabled = userAnswers[currentQuestionIndex] !== null;

    const p = document.createElement("p");
    p.textContent = q.text || "Question sans texte";
    questionContainer.appendChild(p);

    if(Array.isArray(q.media)){
        q.media.forEach(m=>{
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
        btn.addEventListener("click",()=>{
            if(!canAnswer) return;
            answersContainer.querySelectorAll("button").forEach(b=>b.classList.remove("selected"));
            btn.classList.add("selected");
            submitAnswerBtn.disabled = false;
            submitAnswerBtn.dataset.selectedIndex = i;
        });
        answersContainer.appendChild(btn);
    });
}

// ==== SUBMIT ANSWER ====
submitAnswerBtn.addEventListener("click",()=>{
    if(!canAnswer) return;
    const idx = Number(submitAnswerBtn.dataset.selectedIndex);
    socket.emit("submitAnswer",{qIndex:currentQuestionIndex,answerIndex:idx});
    userAnswers[currentQuestionIndex] = idx;
    submitAnswerBtn.disabled = true;
    canAnswer = false;
    quizNotification.textContent = "Réponse envoyée";
});

// ==== TIMER SYNCHRONISE ====
function launchTimer(endTime){
    if(timerInterval) clearInterval(timerInterval); // <-- nettoyer l'ancien interval
    const timerDisplay = document.getElementById("question-timer");

    function updateTimer(){
        const remaining = Math.max(0, Math.ceil((endTime - Date.now())/1000));
        timerDisplay.textContent = `Temps restant: ${remaining}s`;
        if(remaining <= 0){
            clearInterval(timerInterval);
            canAnswer = false;
            submitAnswerBtn.disabled = true;

            if(userAnswers[currentQuestionIndex]===null){
                socket.emit("submitAnswer",{qIndex:currentQuestionIndex,answerIndex:null});
            }

            if(currentQuestionIndex < quizQuestions.length - 1){
                currentQuestionIndex++;
                renderQuestion();
            } else {
                mainQuiz.style.display = "none";
                socket.emit("startCorrection");
            }
        }
    }

    updateTimer();
    timerInterval = setInterval(updateTimer, 500);
}


// ==== QUIZ START EVENT ====
socket.on("startQuiz", ({ questions, endTime })=>{
    if(!questions || !questions.length) return showPopup("Aucune question disponible.");

    quizQuestions = questions;
    currentQuestionIndex = 0;
    userAnswers = new Array(quizQuestions.length).fill(null);

    document.getElementById("lobby").style.display="none";
    mainQuiz.style.display="flex";
    correctionPanel.style.display="none";

    renderQuestion();
    launchTimer(endTime);
});
