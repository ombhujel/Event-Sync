const fs = require("fs");
const http = require("http");
const url = require("url");
const https = require("https");
const crypto = require("crypto");
const port = 3001;
const server = http.createServer();
const task_states = [];
const {ticketmaster_key, client_id, client_secret, scope, redirect_uri, key} = require("./auth/credentials.json")


//All the requets made on localhost:3001 will be caught up here.
//localhost:3001/ in the first if statement
//localhost:3001/search/ is when users type zip code and press enter, which will get caught up by 2nd if statement
//localhost:3001/receive_code/ is caught by third statement, which google calender api redirect the users towards.
server.on("request", request_handler);
function request_handler(req, res){
    console.log(`New Request from ${req.socket.remoteAddress} for ${req.url}`);
    if(req.url === "/"){
        const form = fs.createReadStream("html/index.html");
		res.writeHead(200, {"Content-Type": "text/html"})
		form.pipe(res);
    }
    else if (req.url.startsWith("/search")){
		let {postalCode} = url.parse(req.url,true).query;
		get_event_information(postalCode, res)
    }
	
    else if(req.url.startsWith("/receive_code")){
		const {state, code} = url.parse(req.url, true).query;
		let task_state = task_states.find(task_state => task_state.state === state);
        if(code === undefined || state === undefined || task_state === undefined){
			not_found(res);
			return;
		}
		const {task} = task_state;
		send_access_token_request(code, task, res);
	}
    else{
		not_found(res);
    }
}

//If localhots:3001 is added with wrong endpoint, or if the API call on ticket master returns null, this function
// not_found is initiated
function not_found(res){
	res.writeHead(404, {"Content-Type": "text/html"});
	res.end(`<h1>404 Not Found</h1>`);
}

//This function is initiated when user provide the zipcode to our server. It will basically start teh ticketmaster api call.
function get_event_information(postalCode, res){
	console.log("Calling Ticketmaster API");
	const jobs_endpoint = `https://app.ticketmaster.com/discovery/v2/events.json?countryCode=US&postalCode=${postalCode}&apikey=${ticketmaster_key}`;
	const jobs_request = https.get(jobs_endpoint, {method:"GET"});
	jobs_request.once("response", process_stream);
	function process_stream (event_stream){
		let event_data = "";
		event_stream.on("data", chunk => event_data += chunk);
		event_stream.on("end", () => serve_results(event_data, res));
	}
}

//This function is initiated after we get the response from the ticketmaster API.
function serve_results(event_data, res){
	let event_object = JSON.parse(event_data);
	let event = event_object?._embedded?.events;
	if(event === undefined){
		not_found(res);
			return;
	}
	
	let name = event[0] && event[0].name;
	let start_date = event[0] && event[0].dates && event[0].dates.start && event[0].dates.start.localDate;
	let start_time = event[0] && event[0].dates && event[0].dates.start && event[0].dates.start.localTime;
	let date_time = `${start_date}T${start_time}-04:00`;

	let json = {"end": {"dateTime":`${date_time}`},"start": {"dateTime":`${date_time}`},"description":`${name}`};
	const task = json;
	const state = crypto.randomBytes(20).toString("hex");
	task_states.push({task, state});
	redirect_to_google(state, res);
}

//After we parse the result from ticketmaster api, we call this function, which is basically asking users to log in and grant permission 
//if they haven't done so already.
function redirect_to_google(state, res){
	const authorization_endpoint = "https://accounts.google.com/o/oauth2/v2/auth";
	const response_type = "code";
    let uri = new URLSearchParams({client_id, scope, state, response_type, redirect_uri}).toString();
	res.writeHead(302, {Location: `${authorization_endpoint}?${uri}`})
	   .end();
}

//This function is initiated, after user grants the premission for our server to access their account.
function send_access_token_request(code, json, res) {
    const token_endpoint = "https://oauth2.googleapis.com/token";
	const grant_type = "authorization_code";
    let post_data = new URLSearchParams({client_id, client_secret, code, grant_type, redirect_uri}).toString();
    let options = {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
    };
    https.request(token_endpoint, options, 
        (token_stream) => process_stream(token_stream, receive_access_token, json, res)
    ).end(post_data);
}

//This function the callback call.
function process_stream(stream, callback, ...args) {
    let body = "";
    stream.on("data", (chunk) => (body += chunk));
    stream.on("end", () => callback(body, ...args));
}

//This function uses the user
function receive_access_token(body, json, res) {
	const {access_token} = JSON.parse(body);
    send_add_task_request(json, access_token, res);
}

//This function sends "post" request to the users google calender api, to post the event.
function send_add_task_request(task, access_token, res){
	console.log("Calling calender api after gaining access token");
	const task_endpoint = `https://www.googleapis.com/calendar/v3/calendars/primary/events?key=${key}&scope=${scope}&client_id=${client_id}`;
	const post_data = JSON.stringify(task);
	const options = {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"Accept": "application/json",
			Authorization: `Bearer ${access_token}`
		}
	}
	https.request(
		task_endpoint, 
		options, 
		(task_stream) => process_stream(task_stream, receive_task_response, res)
	).end(post_data);
}

//After posting the event, this function finally sends the redirect link, redirecting users to their google calender, where the event
//have been posted.
function receive_task_response(body, res){
	const results = JSON.parse(body);
	res.writeHead(302, {Location: `${results.htmlLink}`})
	   .end();
	
}

server.on("listening", listen_handler)
function listen_handler(){
    console.log('Now listening on: ');
}
server.listen(port);
