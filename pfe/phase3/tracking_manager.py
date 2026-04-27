import time
from collections import defaultdict

class TrackingManager:
    """
    Manages object tracking IDs and prevents alert spam.
    """
    def __init__(self, cooldown=5.0):
        """
        Args:
            cooldown: Time in seconds before re-alerting for the same object ID.
        """
        self.cooldown = cooldown
        self.last_seen = {} # {track_id: timestamp}
        self.active_ids = set()

    def should_alert(self, track_id):
        """
        Determines if an alert should be triggered for a given track ID.
        """
        now = time.time()
        if track_id not in self.last_seen:
            self.last_seen[track_id] = now
            return True
        
        if now - self.last_seen[track_id] > self.cooldown:
            self.last_seen[track_id] = now
            return True
            
        return False

    def update_active(self, current_ids):
        """
        Updates the set of currently active IDs.
        Used to cleanup old IDs from last_seen if they haven't been seen for a long time.
        """
        self.active_ids = set(current_ids)
        # Optional: cleanup logic for very old IDs
        now = time.time()
        expired = [tid for tid, ts in self.last_seen.items() if now - ts > 60] # cleanup after 1 min
        for tid in expired:
            if tid not in self.active_ids:
                del self.last_seen[tid]
