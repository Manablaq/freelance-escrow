# v0.1.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json

# FreelanceMarket — Full marketplace with profiles, roles, and AI-verified escrow
# Flow: register(role) → freelancers list on marketplace → client hires → escrow → AI verify → paid
# Roles: "freelancer" or "client"
# gl.message_raw["datetime"] for timestamps
# DynArray[str] for freelancer address list (docs confirmed)
# TreeMap[str, str] for profiles and jobs
# emit_transfer for paying freelancers (verified from value-transfers docs)


def _safe_json(text: str) -> dict:
    try:
        s = text.strip()
        if s.startswith("```"):
            s = s.split("```")[1]
            if s.startswith("json"):
                s = s[4:]
        return json.loads(s.strip())
    except:
        return {}


def _clean(text: str, maxlen: int = 500) -> str:
    return text[:maxlen].replace('"', "'") if text else ""


@gl.evm.contract_interface
class _EOARecipient:
    class View:
        pass
    class Write:
        pass


class FreelanceMarket(gl.Contract):
    # address (lowercase) -> JSON profile string
    profiles: TreeMap[str, str]
    # ordered list of freelancer addresses for marketplace
    freelancer_list: DynArray[str]
    # job_id -> JSON job record
    jobs: TreeMap[str, str]
    # job_id -> locked GEN in wei (stored as str)
    escrow_balances: TreeMap[str, str]
    # counters
    job_count: str
    total_paid: str
    freelancer_count: str

    def __init__(self):
        self.job_count = "0"
        self.total_paid = "0"
        self.freelancer_count = "0"

    # ── PROFILE METHODS ────────────────────────────────────────────────────────

    @gl.public.write
    def register(
        self,
        role: str,
        name: str,
        bio: str,
        skills: str,
        rate: str,
        rate_type: str,
        portfolio: str,
        twitter: str,
        github: str,
    ) -> None:
        """
        Register as a freelancer or client.
        role: "freelancer" or "client"
        rate: price in GEN (e.g. "5")
        rate_type: "hourly" or "fixed"
        """
        assert role in ["freelancer", "client"], "Role must be 'freelancer' or 'client'."
        assert len(name) >= 2 and len(name) <= 60, "Name must be 2-60 characters."

        address = str(gl.message.sender_address)
        addr_key = address.lower()
        now_str = gl.message_raw["datetime"]

        # Prevent re-registration (use update_profile to update)
        existing = self.profiles.get(addr_key, None)
        assert existing is None, "Already registered. Use update_profile to update."

        profile = json.dumps({
            "address": address,
            "role": role,
            "name": _clean(name, 60),
            "bio": _clean(bio, 300),
            "skills": _clean(skills, 200),
            "rate": _clean(rate, 20),
            "rate_type": rate_type if rate_type in ["hourly", "fixed"] else "fixed",
            "portfolio": _clean(portfolio, 200),
            "twitter": _clean(twitter, 60),
            "github": _clean(github, 60),
            "registered_at": now_str,
            "jobs_completed": "0",
            "total_earned": "0",
        })

        self.profiles[addr_key] = profile

        # Add to freelancer list for marketplace
        if role == "freelancer":
            self.freelancer_list.append(address)
            try:
                self.freelancer_count = str(int(self.freelancer_count) + 1)
            except:
                self.freelancer_count = "1"

    @gl.public.write
    def update_profile(
        self,
        name: str,
        bio: str,
        skills: str,
        rate: str,
        rate_type: str,
        portfolio: str,
        twitter: str,
        github: str,
    ) -> None:
        """Update profile info. Cannot change role."""
        address = str(gl.message.sender_address)
        addr_key = address.lower()

        raw = self.profiles.get(addr_key, None)
        assert raw is not None, "Not registered. Call register first."

        profile = json.loads(raw)
        assert len(name) >= 2 and len(name) <= 60, "Name must be 2-60 characters."

        profile["name"] = _clean(name, 60)
        profile["bio"] = _clean(bio, 300)
        profile["skills"] = _clean(skills, 200)
        profile["rate"] = _clean(rate, 20)
        profile["rate_type"] = rate_type if rate_type in ["hourly", "fixed"] else "fixed"
        profile["portfolio"] = _clean(portfolio, 200)
        profile["twitter"] = _clean(twitter, 60)
        profile["github"] = _clean(github, 60)

        self.profiles[addr_key] = json.dumps(profile)

    # ── JOB METHODS ───────────────────────────────────────────────────────────

    @gl.public.write
    def create_job(
        self,
        title: str,
        description: str,
        freelancer: str,
        deadline: str,
    ) -> None:
        """
        Client creates a job offer for a specific freelancer.
        Caller must be registered as a client.
        freelancer: must be registered as a freelancer.
        """
        client = str(gl.message.sender_address)
        client_key = client.lower()
        freelancer_key = freelancer.lower()
        now_str = gl.message_raw["datetime"]

        # Validate caller is a registered client
        client_profile_raw = self.profiles.get(client_key, None)
        assert client_profile_raw is not None, "You must register as a client first."
        client_profile = json.loads(client_profile_raw)
        assert client_profile["role"] == "client", "Only clients can post jobs."

        # Validate freelancer is registered
        freelancer_profile_raw = self.profiles.get(freelancer_key, None)
        assert freelancer_profile_raw is not None, "Freelancer is not registered on the platform."
        freelancer_profile = json.loads(freelancer_profile_raw)
        assert freelancer_profile["role"] == "freelancer", "The specified address is not a freelancer."

        # Validate job fields
        assert len(title) >= 3 and len(title) <= 100, "Title must be 3-100 characters."
        assert len(description) >= 20, "Description must be at least 20 characters."
        assert client.lower() != freelancer.lower(), "Client and freelancer cannot be the same address."

        try:
            count = int(self.job_count) + 1
        except:
            count = 1

        job_id = str(count)

        record = json.dumps({
            "job_id": job_id,
            "title": _clean(title, 100),
            "description": _clean(description, 1000),
            "client": client,
            "client_name": client_profile.get("name", ""),
            "freelancer": freelancer,
            "freelancer_name": freelancer_profile.get("name", ""),
            "freelancer_rate": freelancer_profile.get("rate", ""),
            "freelancer_rate_type": freelancer_profile.get("rate_type", ""),
            "deadline": _clean(deadline, 30),
            "status": "OPEN",
            "created_at": now_str,
            "funded_at": "",
            "submitted_at": "",
            "resolved_at": "",
            "deliverable_url": "",
            "ai_verdict": "",
            "ai_reasoning": "",
        })

        self.jobs[job_id] = record
        self.escrow_balances[job_id] = "0"
        self.job_count = job_id

    @gl.public.write.payable
    def fund_job(self, job_id: str) -> None:
        """Client locks GEN into escrow. Status → FUNDED."""
        amount = gl.message.value
        assert amount > u256(0), "Must send GEN to fund the job."

        raw = self.jobs.get(job_id, None)
        assert raw is not None, f"Job {job_id} not found."

        record = json.loads(raw)
        sender = str(gl.message.sender_address)

        assert record["client"].lower() == sender.lower(), "Only the client can fund this job."
        assert record["status"] == "OPEN", "Job must be OPEN to fund. Status: " + record["status"]

        now_str = gl.message_raw["datetime"]
        record["status"] = "FUNDED"
        record["funded_at"] = now_str
        self.jobs[job_id] = json.dumps(record)

        current = int(self.escrow_balances.get(job_id, "0"))
        self.escrow_balances[job_id] = str(current + int(amount))

    @gl.public.write
    def submit_work(self, job_id: str, deliverable_url: str) -> None:
        """Freelancer submits completed work as a public URL. Status → SUBMITTED."""
        raw = self.jobs.get(job_id, None)
        assert raw is not None, f"Job {job_id} not found."

        record = json.loads(raw)
        sender = str(gl.message.sender_address)

        assert record["freelancer"].lower() == sender.lower(), "Only the assigned freelancer can submit."
        assert record["status"] == "FUNDED", "Job must be FUNDED before submission. Status: " + record["status"]
        assert len(deliverable_url) >= 10 and deliverable_url.startswith("http"), "Provide a valid public URL."

        now_str = gl.message_raw["datetime"]
        record["status"] = "SUBMITTED"
        record["deliverable_url"] = _clean(deliverable_url, 500)
        record["submitted_at"] = now_str
        self.jobs[job_id] = json.dumps(record)

    @gl.public.write
    def verify_and_release(self, job_id: str) -> None:
        """
        AI validators fetch the deliverable URL and verify it meets the job description.
        APPROVED → GEN auto-released to freelancer + reputation updated.
        REJECTED → job moves to DISPUTED, client can refund.
        """
        raw = self.jobs.get(job_id, None)
        assert raw is not None, f"Job {job_id} not found."

        record = json.loads(raw)
        sender = str(gl.message.sender_address)

        assert record["client"].lower() == sender.lower(), "Only the client can trigger verification."
        assert record["status"] == "SUBMITTED", "Job must be SUBMITTED. Status: " + record["status"]

        title = record["title"]
        description = record["description"]
        deliverable_url = record["deliverable_url"]
        freelancer = record["freelancer"]

        # ── NONDET: fetch deliverable + AI verdict ────────────────────────────
        def _fetch_and_evaluate() -> str:
            fetched = ""
            try:
                response = gl.nondet.web.get(deliverable_url)
                fetched = response.body.decode("utf-8")[:4000]
            except:
                fetched = ""

            return (
                "JOB TITLE: " + title + "\n\n"
                "JOB DESCRIPTION: " + description + "\n\n"
                "DELIVERABLE URL: " + deliverable_url + "\n\n"
                "DELIVERABLE CONTENT:\n" +
                (fetched if fetched else "[Could not fetch — evaluate from URL and context only]")
            )

        verdict_raw = gl.eq_principle.prompt_non_comparative(
            _fetch_and_evaluate,
            task=(
                "You are an impartial AI arbitrator for a freelance escrow on GenLayer.\n"
                "Evaluate whether the submitted deliverable meets the job requirements.\n\n"
                "APPROVE if:\n"
                "- The URL is accessible and contains real work\n"
                "- The work is relevant to the job title and description\n"
                "- Quality is reasonable for the scope described\n\n"
                "REJECT if:\n"
                "- The URL is broken, empty, or clearly unrelated\n"
                "- No meaningful deliverable exists\n"
                "- The work is entirely off-scope\n\n"
                "Be fair. Freelancers deserve payment for real work.\n"
                "Reply ONLY with valid JSON."
            ),
            criteria=(
                "Validate format only. Accept if: "
                "(1) valid JSON object, "
                "(2) 'approved' field is exactly true or false (boolean), "
                "(3) 'reasoning' field is a non-empty string. "
                "No semantic evaluation."
            ),
        )
        # ── END NONDET ────────────────────────────────────────────────────────

        verdict_data = _safe_json(verdict_raw)
        approved = verdict_data.get("approved", False)
        reasoning = _clean(str(verdict_data.get("reasoning", "No reasoning provided.")), 500)

        balance = int(self.escrow_balances.get(job_id, "0"))
        now_str = gl.message_raw["datetime"]

        if approved:
            record["status"] = "PAID"
            record["ai_verdict"] = "APPROVED"
            record["ai_reasoning"] = reasoning
            record["resolved_at"] = now_str
            self.jobs[job_id] = json.dumps(record)
            self.escrow_balances[job_id] = "0"

            # Update total paid
            try:
                self.total_paid = str(int(self.total_paid) + balance)
            except:
                self.total_paid = str(balance)

            # Update freelancer reputation
            fl_key = freelancer.lower()
            fl_raw = self.profiles.get(fl_key, None)
            if fl_raw:
                fl_profile = json.loads(fl_raw)
                try:
                    fl_profile["jobs_completed"] = str(int(fl_profile.get("jobs_completed", "0")) + 1)
                    fl_profile["total_earned"] = str(int(fl_profile.get("total_earned", "0")) + balance)
                except:
                    pass
                self.profiles[fl_key] = json.dumps(fl_profile)

            # Pay freelancer
            _EOARecipient(Address(freelancer)).emit_transfer(value=u256(balance))
        else:
            record["status"] = "DISPUTED"
            record["ai_verdict"] = "REJECTED"
            record["ai_reasoning"] = reasoning
            record["resolved_at"] = now_str
            self.jobs[job_id] = json.dumps(record)

    @gl.public.write
    def client_refund(self, job_id: str) -> None:
        """Client reclaims GEN when job is DISPUTED or FUNDED."""
        raw = self.jobs.get(job_id, None)
        assert raw is not None, f"Job {job_id} not found."

        record = json.loads(raw)
        sender = str(gl.message.sender_address)

        assert record["client"].lower() == sender.lower(), "Only the client can request a refund."
        assert record["status"] in ["DISPUTED", "FUNDED"], (
            "Refund only available for DISPUTED or FUNDED jobs. Status: " + record["status"]
        )

        balance = int(self.escrow_balances.get(job_id, "0"))
        assert balance > 0, "No balance to refund."

        now_str = gl.message_raw["datetime"]
        record["status"] = "REFUNDED"
        record["resolved_at"] = now_str
        self.jobs[job_id] = json.dumps(record)
        self.escrow_balances[job_id] = "0"

        client = record["client"]
        _EOARecipient(Address(client)).emit_transfer(value=u256(balance))

    @gl.public.write
    def cancel_job(self, job_id: str) -> None:
        """Cancel an OPEN job (not yet funded)."""
        raw = self.jobs.get(job_id, None)
        assert raw is not None, f"Job {job_id} not found."

        record = json.loads(raw)
        sender = str(gl.message.sender_address)

        assert record["client"].lower() == sender.lower(), "Only the client can cancel."
        assert record["status"] == "OPEN", "Only OPEN jobs can be cancelled."

        record["status"] = "CANCELLED"
        self.jobs[job_id] = json.dumps(record)

    # ── READ METHODS ───────────────────────────────────────────────────────────

    @gl.public.view
    def get_profile(self, address: str) -> str:
        """Get profile for any address."""
        raw = self.profiles.get(address.lower(), None)
        if raw is None:
            return json.dumps({"found": False, "address": address})
        profile = json.loads(raw)
        profile["found"] = True
        return json.dumps(profile)

    @gl.public.view
    def get_all_freelancers(self) -> str:
        """Return all registered freelancers for the marketplace (max 100)."""
        result = []
        count = 0
        for addr in self.freelancer_list:
            if count >= 100:
                break
            raw = self.profiles.get(addr.lower(), None)
            if raw:
                try:
                    p = json.loads(raw)
                    result.append(p)
                except:
                    pass
            count += 1
        return json.dumps(result)

    @gl.public.view
    def get_job(self, job_id: str) -> str:
        """Get full job record including escrow balance."""
        raw = self.jobs.get(job_id, None)
        if raw is None:
            return json.dumps({"found": False, "job_id": job_id})
        record = json.loads(raw)
        record["found"] = True
        record["escrow_balance"] = self.escrow_balances.get(job_id, "0")
        return json.dumps(record)

    @gl.public.view
    def get_jobs_by_client(self, client: str) -> str:
        """Get all jobs posted by a client address (max 100)."""
        result = []
        count = 0
        for key in self.jobs.keys():
            if count >= 100:
                break
            try:
                record = json.loads(self.jobs[key])
                if record.get("client", "").lower() == client.lower():
                    record["escrow_balance"] = self.escrow_balances.get(key, "0")
                    result.append(record)
            except:
                pass
            count += 1
        return json.dumps(result)

    @gl.public.view
    def get_jobs_by_freelancer(self, freelancer: str) -> str:
        """Get all jobs assigned to a freelancer address (max 100)."""
        result = []
        count = 0
        for key in self.jobs.keys():
            if count >= 100:
                break
            try:
                record = json.loads(self.jobs[key])
                if record.get("freelancer", "").lower() == freelancer.lower():
                    record["escrow_balance"] = self.escrow_balances.get(key, "0")
                    result.append(record)
            except:
                pass
            count += 1
        return json.dumps(result)

    @gl.public.view
    def get_stats(self) -> str:
        """Global marketplace stats."""
        return json.dumps({
            "total_jobs": self.job_count or "0",
            "total_paid": self.total_paid or "0",
            "total_freelancers": self.freelancer_count or "0",
        })
