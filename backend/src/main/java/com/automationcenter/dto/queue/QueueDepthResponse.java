package com.automationcenter.dto.queue;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class QueueDepthResponse {
    private String queueName;
    private int ready;
    private int unacknowledged;
    private int total;
}
